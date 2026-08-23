import { desc, eq, and, gte, lte, isNull, isNotNull } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { db } from "./db/client.js";
import { visits, places, trips } from "./db/schema.js";
import { createPlace } from "./places.js";
import { haversineMeters } from "./geo.js";
import type { Visit, VisitStatus, ClassifyVisitRequest, Trip, TripMode } from "./types.js";

export type VisitRow = typeof visits.$inferSelect;

function toVisit(row: { visit: VisitRow; place: typeof places.$inferSelect | null }): Visit {
  const { visit, place } = row;
  const durationMinutes = visit.departedAt
    ? Math.round((visit.departedAt.getTime() - visit.arrivedAt.getTime()) / 60000)
    : null;
  return {
    id: visit.id,
    placeId: visit.placeId,
    placeName: place?.name ?? null,
    placeCategory: place?.category ?? null,
    status: visit.status,
    adhocLabel: visit.adhocLabel,
    clusterLatitude: visit.clusterLatitude,
    clusterLongitude: visit.clusterLongitude,
    latitude: place?.latitude ?? visit.clusterLatitude,
    longitude: place?.longitude ?? visit.clusterLongitude,
    arrivedAt: visit.arrivedAt.toISOString(),
    departedAt: visit.departedAt ? visit.departedAt.toISOString() : null,
    durationMinutes,
  };
}

function visitSelection() {
  return db.select({ visit: visits, place: places }).from(visits).leftJoin(places, eq(visits.placeId, places.id));
}

// Visits are the durable record this whole Chamber exists to produce (see
// the visits table's own schema comment) - a personal location diary, not a
// disposable log like event_history - so unlike that table this has no
// time-based retention sweep deleting rows. What it does need is a ceiling
// on one unfiltered read, since GPS polling accumulates visits/trips
// continuously with no natural cap the way most other Chambers' content
// does: an owner years into using this Chamber shouldn't have every visit
// they've ever had loaded into memory and serialized just to answer "what's
// recent" (both list pages sort by this same field already).
const DEFAULT_LIST_LIMIT = 500;

export interface ListVisitsFilter {
  status?: VisitStatus;
  from?: Date;
  to?: Date;
  limit?: number;
}

export async function listVisits(filter: ListVisitsFilter = {}): Promise<Visit[]> {
  const conditions = [];
  if (filter.status) {
    conditions.push(eq(visits.status, filter.status));
    // "pending" specifically means "worth asking about" - a spot only
    // reaches pendingNotifiedAt once it's dwelled past minDwellMs (see
    // tracking.ts's maybeFlagPending). Without this, every fleeting
    // unmatched fix along a drive/bus ride (each opens then closes its own
    // "pending" row in seconds, well under minDwellMs) would still surface
    // here for classification, even though Settings already documents this
    // page as filtering them out.
    if (filter.status === "pending") conditions.push(isNotNull(visits.pendingNotifiedAt));
  }
  if (filter.from) conditions.push(gte(visits.arrivedAt, filter.from));
  if (filter.to) conditions.push(lte(visits.arrivedAt, filter.to));

  const rows = visitSelection()
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(visits.arrivedAt))
    .limit(filter.limit ?? DEFAULT_LIST_LIMIT)
    .all();
  return rows.map(toVisit);
}

export async function getVisit(id: number): Promise<Visit | null> {
  const row = visitSelection().where(eq(visits.id, id)).get();
  return row ? toVisit(row) : null;
}

// The visit currently open (no departure recorded yet), if any - re-derived
// from the DB on every poll tick rather than cached in memory, so a Chamber
// restart never loses track of "where you currently are" (unlike the
// in-transit position buffer below, which is a genuinely accepted gap).
export function getOpenVisit(): VisitRow | null {
  return db.select().from(visits).where(isNull(visits.departedAt)).orderBy(desc(visits.arrivedAt)).get() ?? null;
}

export function openConfirmedVisit(placeId: number, arrivedAt: Date): VisitRow {
  const now = new Date();
  return db
    .insert(visits)
    .values({ placeId, status: "confirmed", arrivedAt, createdAt: now, updatedAt: now })
    .returning()
    .get();
}

export function openPendingVisit(clusterLatitude: number, clusterLongitude: number, arrivedAt: Date): VisitRow {
  const now = new Date();
  return db
    .insert(visits)
    .values({ status: "pending", clusterLatitude, clusterLongitude, arrivedAt, createdAt: now, updatedAt: now })
    .returning()
    .get();
}

export function closeVisit(id: number, departedAt: Date): void {
  db.update(visits).set({ departedAt, updatedAt: new Date() }).where(eq(visits.id, id)).run();
}

export function markPendingNotified(id: number, at: Date): void {
  db.update(visits).set({ pendingNotifiedAt: at, updatedAt: new Date() }).where(eq(visits.id, id)).run();
}

export async function classifyVisit(id: number, request: ClassifyVisitRequest): Promise<Visit | null> {
  const existing = db.select().from(visits).where(eq(visits.id, id)).get();
  if (!existing) return null;

  if (request.action === "save_place") {
    // Saving a spot with category "ignored" *is* the "stop asking about
    // this" mechanism - see db/schema.ts's comment on places.category.
    const place = await createPlace({
      name: request.name,
      body: request.body,
      category: request.category,
      latitude: existing.clusterLatitude ?? 0,
      longitude: existing.clusterLongitude ?? 0,
      radiusMeters: request.radiusMeters,
    });
    db.update(visits)
      .set({ placeId: place.id, status: "confirmed", updatedAt: new Date() })
      .where(eq(visits.id, id))
      .run();
  } else if (request.action === "assign_place") {
    db.update(visits)
      .set({ placeId: request.placeId, status: "confirmed", updatedAt: new Date() })
      .where(eq(visits.id, id))
      .run();
  } else if (request.action === "adhoc_label") {
    db.update(visits)
      .set({ adhocLabel: request.label, status: "adhoc", updatedAt: new Date() })
      .where(eq(visits.id, id))
      .run();
  } else {
    db.update(visits).set({ status: "ignored", updatedAt: new Date() }).where(eq(visits.id, id)).run();
  }

  return getVisit(id);
}

// --- Trips ---

const KNOTS_TO_KMH = 1.852;

// What a trip's distance/mode guess are actually computed from - a running
// sum of consecutive-fix distances and a running max speed, not the whole
// raw-fix history. Replaces an older unbounded array of every fix seen
// since the last visit closed: distance and max speed are both naturally
// streaming reductions, so a long journey with no recognized stop no longer
// grows anything with the trip's length - this is O(1) regardless.
export interface TripFixAccumulator {
  count: number;
  distanceKm: number;
  maxSpeedKnots: number;
  lastFix: { latitude: number; longitude: number } | null;
}

export function createTripFixAccumulator(): TripFixAccumulator {
  return { count: 0, distanceKm: 0, maxSpeedKnots: 0, lastFix: null };
}

export function accumulateTripFix(
  acc: TripFixAccumulator,
  fix: { latitude: number; longitude: number; speedKnots: number }
): void {
  if (acc.lastFix) acc.distanceKm += haversineMeters(acc.lastFix, fix) / 1000;
  acc.maxSpeedKnots = Math.max(acc.maxSpeedKnots, fix.speedKnots);
  acc.lastFix = { latitude: fix.latitude, longitude: fix.longitude };
  acc.count += 1;
}

function guessTripMode(maxSpeedKmh: number): TripMode {
  if (maxSpeedKmh < 7) return "walk";
  if (maxSpeedKmh < 25) return "bike";
  return "drive";
}

const fromVisits = alias(visits, "from_visits");
const toVisits = alias(visits, "to_visits");
const fromPlaces = alias(places, "from_places");
const toPlaces = alias(places, "to_places");

function labelFor(visit: { status: VisitStatus; adhocLabel: string | null }, place: { name: string } | null): string {
  if (place) return place.name;
  if (visit.status === "adhoc" && visit.adhocLabel) return visit.adhocLabel;
  return "Unknown location";
}

function toTrip(row: {
  trip: typeof trips.$inferSelect;
  fromVisit: VisitRow;
  toVisit: VisitRow;
  fromPlace: typeof places.$inferSelect | null;
  toPlace: typeof places.$inferSelect | null;
}): Trip {
  const { trip, fromVisit, toVisit, fromPlace, toPlace } = row;
  return {
    id: trip.id,
    fromVisitId: trip.fromVisitId,
    toVisitId: trip.toVisitId,
    fromLabel: labelFor(fromVisit, fromPlace),
    toLabel: labelFor(toVisit, toPlace),
    departedAt: trip.departedAt.toISOString(),
    arrivedAt: trip.arrivedAt.toISOString(),
    durationMinutes: Math.round((trip.arrivedAt.getTime() - trip.departedAt.getTime()) / 60000),
    distanceKm: trip.distanceKm,
    mode: trip.mode,
  };
}

function tripSelection() {
  return db
    .select({ trip: trips, fromVisit: fromVisits, toVisit: toVisits, fromPlace: fromPlaces, toPlace: toPlaces })
    .from(trips)
    .innerJoin(fromVisits, eq(trips.fromVisitId, fromVisits.id))
    .innerJoin(toVisits, eq(trips.toVisitId, toVisits.id))
    .leftJoin(fromPlaces, eq(fromVisits.placeId, fromPlaces.id))
    .leftJoin(toPlaces, eq(toVisits.placeId, toPlaces.id));
}

export interface ListTripsFilter {
  from?: Date;
  to?: Date;
  limit?: number;
}

export async function listTrips(filter: ListTripsFilter = {}): Promise<Trip[]> {
  const conditions = [];
  if (filter.from) conditions.push(gte(trips.departedAt, filter.from));
  if (filter.to) conditions.push(lte(trips.departedAt, filter.to));

  const rows = tripSelection()
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(trips.departedAt))
    .limit(filter.limit ?? DEFAULT_LIST_LIMIT)
    .all();
  return rows.map(toTrip);
}

export async function getTrip(id: number): Promise<Trip | null> {
  const row = tripSelection().where(eq(trips.id, id)).get();
  return row ? toTrip(row) : null;
}

// distanceKm/mode are rough by design - a running sum/max accumulated while
// in transit (tracking.ts), not the whole raw-fix history. An untouched
// accumulator (e.g. the Chamber restarted mid-trip and lost its in-memory
// state - an accepted gap, same spirit as chamber-tasks' in-memory
// notification state) just yields distanceKm 0.
export async function createTrip(
  fromVisitId: number,
  toVisitId: number,
  departedAt: Date,
  arrivedAt: Date,
  acc: TripFixAccumulator
): Promise<Trip> {
  const maxSpeedKmh = acc.count > 0 ? acc.maxSpeedKnots * KNOTS_TO_KMH : 0;
  const mode: TripMode = acc.count === 0 ? "unknown" : guessTripMode(maxSpeedKmh);

  const inserted = db
    .insert(trips)
    .values({ fromVisitId, toVisitId, departedAt, arrivedAt, distanceKm: acc.distanceKm, mode, createdAt: new Date() })
    .returning()
    .get();

  const trip = await getTrip(inserted.id);
  if (!trip) throw new Error(`failed to read back inserted trip ${inserted.id}`);
  return trip;
}
