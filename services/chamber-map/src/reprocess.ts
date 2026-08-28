import { and, desc, eq, gte, inArray, isNotNull, lt } from "drizzle-orm";
import { db } from "./db/client.js";
import { visits, trips } from "./db/schema.js";
import { findEarliestFixNear, listPositionsBetween } from "./positions.js";
import { processPositions, resetTrackingState, withTrackingLock } from "./tracking.js";
import { claimStrength } from "./annotationMatching.js";
import type { ReprocessResult } from "./types.js";

// Visits and trips are derived summaries over `positions` (see that table's
// own schema comment - it is their source of truth, not the other way
// around), which is what makes them safe to throw away and recompute. That
// single fact is what this module exists to exploit: a place added after
// the fact, a radius corrected, a threshold retuned, or a bug fixed in the
// classifier can all be applied to history by replaying the raw fixes back
// through the exact same code path the live poller uses, rather than by
// hand-patching rows.
//
// What it deliberately does NOT recompute is anything the owner authored:
// adhoc labels, "ignored" dwells, and trip labels are snapshotted before
// the delete and re-applied to whatever the replay produced in their place
// (see restoreVisitAnnotations/restoreTripLabels). Everything else -
// confirmed visits, pending dwells, trips - is fully derivable and simply
// regenerated.

// How far back adding or moving a place is willing to rewrite history. A
// place never visited reprocesses nothing at all (reprocessForPlace returns
// null), so this only bounds the case where the oldest matching fix is
// ancient - one small edit shouldn't silently re-derive years of history.
// A manual rebuild can still be pointed further back explicitly.
const PLACE_LOOKBACK_DAYS = 90;

type VisitRow = typeof visits.$inferSelect;
type TripRow = typeof trips.$inferSelect;

function visitSpan(row: VisitRow, openEnd: number): { start: number; end: number } {
  return { start: row.arrivedAt.getTime(), end: row.departedAt?.getTime() ?? openEnd };
}

function tripSpan(row: TripRow): { start: number; end: number } {
  return { start: row.departedAt.getTime(), end: row.arrivedAt.getTime() };
}

// Re-attaches an owner-authored visit annotation to whichever regenerated
// dwell occupies the same stretch of time. Only ever lands on a still-
// unclassified ("pending") visit: if the replay matched that stretch to a
// real place instead, the place is the better answer and an old "ignored"
// or one-off label shouldn't override it.
function restoreVisitAnnotations(saved: VisitRow[], openEnd: number): { restored: number; lost: number } {
  const candidates = db.select().from(visits).where(eq(visits.status, "pending")).all();
  const claimed = new Set<number>();
  let restored = 0;
  let lost = 0;

  for (const snapshot of saved) {
    const span = visitSpan(snapshot, openEnd);
    let best: { row: VisitRow; overlap: number } | null = null;
    for (const candidate of candidates) {
      if (claimed.has(candidate.id)) continue;
      const overlap = claimStrength(span, visitSpan(candidate, openEnd));
      if (overlap > 0 && (!best || overlap > best.overlap)) best = { row: candidate, overlap };
    }
    if (!best) {
      lost += 1;
      continue;
    }
    db.update(visits)
      .set({ status: snapshot.status, adhocLabel: snapshot.adhocLabel, updatedAt: new Date() })
      .where(eq(visits.id, best.row.id))
      .run();
    claimed.add(best.row.id);
    restored += 1;
  }
  return { restored, lost };
}

// Only ever fills a trip whose label came back empty. A trip between two
// different known places labels itself ("commute to X") during the replay,
// and that regenerated label is by definition current - carrying the old
// one over it would at best duplicate it and at worst stamp a stale
// destination onto a trip that no longer goes there. What's left unlabelled
// after a replay is exactly the same-place round trip the classifier
// deliberately declines to name (see visits.ts's needsLabel), which is
// where an owner-authored label lives.
function restoreTripLabels(saved: TripRow[], from: Date): { restored: number; lost: number } {
  const inRange = db.select().from(trips).where(gte(trips.departedAt, from)).all();
  const candidates = inRange.filter((row) => row.label === null);
  const claimed = new Set<number>();
  let restored = 0;
  let lost = 0;

  for (const snapshot of saved) {
    const span = tripSpan(snapshot);
    // A label the replay reproduced by itself is already current, so it
    // counts as neither restored nor lost - it never went anywhere.
    if (inRange.some((row) => row.label === snapshot.label && claimStrength(span, tripSpan(row)) > 0)) continue;
    let best: { row: TripRow; overlap: number } | null = null;
    for (const candidate of candidates) {
      if (claimed.has(candidate.id)) continue;
      const overlap = claimStrength(span, tripSpan(candidate));
      if (overlap > 0 && (!best || overlap > best.overlap)) best = { row: candidate, overlap };
    }
    if (!best) {
      lost += 1;
      continue;
    }
    db.update(trips).set({ label: snapshot.label }).where(eq(trips.id, best.row.id)).run();
    claimed.add(best.row.id);
    restored += 1;
  }
  return { restored, lost };
}

// Recomputes every visit and trip from `from` onward out of the raw
// position log, against the places and settings in effect right now.
//
// The visit that was already open when `from` arrived is reopened rather
// than deleted, so it keeps its own (earlier, still-correct) arrival and
// the replay just re-derives when it ended - that's what lets a reprocess
// start mid-stay without inventing a new visit for a stay already
// underway. Not wrapped in a SQL transaction: the replay awaits, and
// better-sqlite3's transactions are synchronous. The tracking lock is what
// keeps a concurrent poll tick out of the window instead.
export async function reprocessRange(from: Date, to: Date = new Date()): Promise<ReprocessResult> {
  return withTrackingLock(async () => {
    const openEnd = to.getTime();

    const savedVisitAnnotations = db
      .select()
      .from(visits)
      .where(and(gte(visits.arrivedAt, from), inArray(visits.status, ["adhoc", "ignored"])))
      .all();
    const savedTripLabels = db
      .select()
      .from(trips)
      .where(and(gte(trips.departedAt, from), isNotNull(trips.label)))
      .all();

    const visitsDeleted = db.select().from(visits).where(gte(visits.arrivedAt, from)).all().length;
    const tripsDeleted = db.select().from(trips).where(gte(trips.departedAt, from)).all().length;

    const anchor = db
      .select()
      .from(visits)
      .where(lt(visits.arrivedAt, from))
      .orderBy(desc(visits.arrivedAt))
      .get();

    // Deleting the visits cascades to every trip that referenced them (the
    // FKs are ON DELETE CASCADE and chamber-kit enables foreign_keys); the
    // explicit trip delete afterwards is belt-and-braces for a trip whose
    // endpoints somehow both predate `from`.
    db.delete(visits).where(gte(visits.arrivedAt, from)).run();
    db.delete(trips).where(gte(trips.departedAt, from)).run();

    if (anchor) {
      db.update(visits).set({ departedAt: null, updatedAt: new Date() }).where(eq(visits.id, anchor.id)).run();
    }

    resetTrackingState();
    const fixes = listPositionsBetween(from, to);
    await processPositions(fixes, { publishEvents: false });
    // The live poller's own carry-over is meaningless after a replay wound
    // the module state to a historical point - drop it so the next real
    // tick starts clean instead of stitching itself onto the replay's tail.
    resetTrackingState();

    const visitAnnotations = restoreVisitAnnotations(savedVisitAnnotations, openEnd);
    const tripAnnotations = restoreTripLabels(savedTripLabels, from);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      positionsReplayed: fixes.length,
      visitsDeleted,
      visitsCreated: db.select().from(visits).where(gte(visits.arrivedAt, from)).all().length,
      tripsDeleted,
      tripsCreated: db.select().from(trips).where(gte(trips.departedAt, from)).all().length,
      annotationsRestored: visitAnnotations.restored + tripAnnotations.restored,
      annotationsLost: visitAnnotations.lost + tripAnnotations.lost,
    };
  });
}

// Called once on boot, before live polling starts. The trip-linking state
// that stitches one visit to the next (tripOrigin/candidateStop in
// tracking.ts) lives only in memory by design - but this Chamber restarts
// often and unpredictably, since every git push redeploys every service,
// including mid-trip if the owner happens to be travelling when one lands.
// Losing that state doesn't corrupt anything already committed, but it does
// leave the *next* visit permanently unlinked - a real stop with no trip
// connecting it to wherever the device came from, since nothing else ever
// retries that link once the moment has passed.
//
// `from` has to be the exact moment the trip leading into the latest visit
// began - the second-to-last visit's own departure, not its arrival and
// not the latest visit's own arrival either. Either of those instead would
// put `from` *inside* an already-correct stay or an already-correct trip,
// reopening a visit that still has no departure yet to replay one from and
// clipping the fixes the trip needs to reconstruct its path/distance/mode -
// collapsing it to a same-instant, same-place non-event rather than
// reconstructing it. Anchoring at the departure itself keeps the
// second-to-last visit untouched (reopened and immediately re-closed at
// the very same fix, since `from` is inclusive) and hands the replay every
// fix the incoming trip actually needs. With fewer than two visits there's
// no preceding trip to have lost, so the latest visit's own arrival is a
// safe (if inert) anchor - and a visit that isn't the latest is always
// already closed, so `departedAt` is never null here.
//
// Replaying (via the exact same code path the live poller uses - see this
// module's own header comment) re-derives the tail correctly whether or
// not anything was actually lost: a boot after a clean shutdown just
// reproduces the same visits/trips unchanged. Returns null when there's no
// visit yet to anchor the replay to (a brand new install).
export async function healTrackingStateOnBoot(): Promise<ReprocessResult | null> {
  const recent = db.select().from(visits).orderBy(desc(visits.arrivedAt)).limit(2).all();
  if (recent.length === 0) return null;
  const from = recent[1]?.departedAt ?? recent[0]!.arrivedAt;
  return reprocessRange(from);
}

// Applies a newly added or moved place to the history it should have
// matched all along. Returns null - reprocessing nothing - when no fix in
// the lookback window ever fell inside the place's radius, which is the
// common case for a place added somewhere new and keeps "add a place" from
// touching history it has no bearing on.
//
// `previous` is the place's own geometry before an edit, so shrinking a
// radius or nudging a pin also reaches back far enough to *remove* the
// visits the old geometry used to match, not just add the new ones.
export async function reprocessForPlace(
  next: { latitude: number; longitude: number; radiusMeters: number },
  previous?: { latitude: number; longitude: number; radiusMeters: number }
): Promise<ReprocessResult | null> {
  const notBefore = new Date(Date.now() - PLACE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const geometries = previous ? [next, previous] : [next];
  const earliest = geometries
    .map((g) => findEarliestFixNear(g.latitude, g.longitude, g.radiusMeters, notBefore))
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  if (!earliest) return null;
  return reprocessRange(earliest);
}
