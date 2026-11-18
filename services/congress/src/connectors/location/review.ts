import { and, eq, gte, isNotNull, isNull, lte, or } from "drizzle-orm";
import { locationDb as db } from "./db/client.js";
import { visitReviews, visits } from "./db/schema.js";
import { haversineMeters } from "./geo.js";
import { listPlaces } from "./places.js";
import { listVisits } from "./visits.js";
import type { Visit } from "./types.js";

// What the AI needs to sort out the stops tracking couldn't place: which stops
// are ready for a look, and the evidence near each one.

// Older stops stay pending untouched; the AI only looks at recent ones.
export const REVIEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
// A stop you're still at is judged only after this long there.
export const SETTLE_MS = 30 * 60 * 1000;
const NEARBY_PLACE_METERS = 2000;
const SIMILAR_LABEL_METERS = 200;

// Pending stops (dwelled past minDwell) that ended, or have lasted long enough, and weren't reviewed. Oldest first.
export async function reviewCandidates(now = Date.now(), limit = 5): Promise<Visit[]> {
  const rows = db
    .select({ id: visits.id })
    .from(visits)
    .leftJoin(visitReviews, eq(visitReviews.arrivedAt, visits.arrivedAt))
    .where(
      and(
        eq(visits.status, "pending"),
        isNotNull(visits.pendingNotifiedAt),
        isNull(visitReviews.arrivedAt),
        gte(visits.arrivedAt, new Date(now - REVIEW_WINDOW_MS)),
        or(isNotNull(visits.departedAt), lte(visits.arrivedAt, new Date(now - SETTLE_MS)))
      )
    )
    .orderBy(visits.arrivedAt)
    .limit(limit)
    .all();
  if (!rows.length) return [];
  const all = await listVisits({ status: "pending", from: new Date(now - REVIEW_WINDOW_MS) });
  const wanted = new Set(rows.map((r) => r.id));
  return all.filter((v) => wanted.has(v.id)).sort((a, b) => a.arrivedAt.localeCompare(b.arrivedAt));
}

export function markReviewed(list: Visit[], at = new Date()): void {
  for (const v of list) {
    db.insert(visitReviews).values({ arrivedAt: new Date(v.arrivedAt), reviewedAt: at }).onConflictDoNothing().run();
  }
}

export const isReviewed = (v: Visit): boolean => Boolean(db.select().from(visitReviews).where(eq(visitReviews.arrivedAt, new Date(v.arrivedAt))).get());

export interface VisitContext {
  visit: Visit;
  // The owner's Places closest to the stop (distance from its centre; the Place's own radius).
  nearbyPlaces: { id: string; name: string; distanceMeters: number; radiusMeters: number }[];
  // Labels the owner (or the AI) gave earlier stops at about the same spot.
  pastLabels: { label: string; times: number }[];
}

export async function visitContext(v: Visit): Promise<VisitContext> {
  const here = v.latitude !== null && v.longitude !== null ? { latitude: v.latitude, longitude: v.longitude } : null;
  if (!here) return { visit: v, nearbyPlaces: [], pastLabels: [] };
  const nearbyPlaces = (await listPlaces())
    .map((p) => ({ id: p.id, name: p.name, distanceMeters: Math.round(haversineMeters(here, p)), radiusMeters: p.radiusMeters }))
    .filter((p) => p.distanceMeters <= NEARBY_PLACE_METERS)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 3);
  const counts = new Map<string, number>();
  for (const a of await listVisits({ status: "adhoc", limit: 500 })) {
    if (!a.adhocLabel || a.latitude === null || a.longitude === null) continue;
    if (haversineMeters(here, { latitude: a.latitude, longitude: a.longitude }) > SIMILAR_LABEL_METERS) continue;
    counts.set(a.adhocLabel, (counts.get(a.adhocLabel) ?? 0) + 1);
  }
  const pastLabels = [...counts].map(([label, times]) => ({ label, times })).sort((a, b) => b.times - a.times).slice(0, 3);
  return { visit: v, nearbyPlaces, pastLabels };
}

