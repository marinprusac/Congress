import { desc, eq, and, gte, lte, isNull } from "drizzle-orm";
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

export interface ListVisitsFilter {
  status?: VisitStatus;
  from?: Date;
  to?: Date;
}

export async function listVisits(filter: ListVisitsFilter = {}): Promise<Visit[]> {
  const conditions = [];
  if (filter.status) conditions.push(eq(visits.status, filter.status));
  if (filter.from) conditions.push(gte(visits.arrivedAt, filter.from));
  if (filter.to) conditions.push(lte(visits.arrivedAt, filter.to));

  const rows = visitSelection()
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(visits.arrivedAt))
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

export interface BufferedFix {
  latitude: number;
  longitude: number;
  // Traccar reports speed in knots - see traccar/client.ts.
  speedKnots: number;
  fixTime: Date;
}

const KNOTS_TO_KMH = 1.852;

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
}

export async function listTrips(filter: ListTripsFilter = {}): Promise<Trip[]> {
  const conditions = [];
  if (filter.from) conditions.push(gte(trips.departedAt, filter.from));
  if (filter.to) conditions.push(lte(trips.departedAt, filter.to));

  const rows = tripSelection()
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(trips.departedAt))
    .all();
  return rows.map(toTrip);
}

export async function getTrip(id: number): Promise<Trip | null> {
  const row = tripSelection().where(eq(trips.id, id)).get();
  return row ? toTrip(row) : null;
}

// distanceKm/mode are rough by design - summed haversine between whatever
// raw fixes happened to be buffered while in transit (tracking.ts), guessed
// mode from their max speed. An empty buffer (e.g. the Chamber restarted
// mid-trip and lost its in-memory buffer - an accepted gap, same spirit as
// chamber-tasks' in-memory notification state) just yields distanceKm 0.
export async function createTrip(
  fromVisitId: number,
  toVisitId: number,
  departedAt: Date,
  arrivedAt: Date,
  buffer: BufferedFix[]
): Promise<Trip> {
  let distanceKm = 0;
  for (let i = 1; i < buffer.length; i++) {
    distanceKm += haversineMeters(buffer[i - 1]!, buffer[i]!) / 1000;
  }
  const maxSpeedKmh = buffer.length ? Math.max(...buffer.map((p) => p.speedKnots * KNOTS_TO_KMH)) : 0;
  const mode: TripMode = buffer.length === 0 ? "unknown" : guessTripMode(maxSpeedKmh);

  const inserted = db
    .insert(trips)
    .values({ fromVisitId, toVisitId, departedAt, arrivedAt, distanceKm, mode, createdAt: new Date() })
    .returning()
    .get();

  const trip = await getTrip(inserted.id);
  if (!trip) throw new Error(`failed to read back inserted trip ${inserted.id}`);
  return trip;
}
