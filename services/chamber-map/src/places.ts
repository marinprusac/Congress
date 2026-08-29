import { desc, eq, like, or } from "drizzle-orm";
import type { PlaceSummary, PlaceDetail, CreatePlaceRequest, UpdatePlaceRequest } from "./types.js";
import { extractOutgoingExhibitRefs, createManualRefsByExhibitId } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { places } from "./db/schema.js";
import { toExhibitId, parsePlaceId, pushExhibitSync } from "./exhibits.js";
import { listManualRefs, addManualRef, removeManualRef, deleteManualRefsForPlace } from "./refs.js";
import { reprocessForPlace } from "./reprocess.js";

// The set of Exhibits this place points at is the union of what's embedded
// in its body ("[[" tokens) and what was added explicitly via the
// References side panel - pushed to Capitol as one outgoingRefs list either
// way. Same shape as chamber-notes/src/notes.ts's syncNoteExhibit.
async function syncPlaceExhibit(id: number, name: string, body: string): Promise<void> {
  const manual = listManualRefs(id);
  const outgoingRefs = new Set([...extractOutgoingExhibitRefs(body), ...manual]);
  await pushExhibitSync({
    id: toExhibitId(id),
    type: "place",
    name,
    url: `/p/${id}`,
    outgoingRefs: [...outgoingRefs],
    manualRefs: manual,
  });
}

// Re-syncs a place whose body didn't change but whose manual refs did (see
// the /api/exhibits/:id/refs routes in server.ts).
export async function resyncPlaceExhibit(id: number): Promise<void> {
  const row = db.select().from(places).where(eq(places.id, id)).get();
  if (!row) return;
  await syncPlaceExhibit(id, row.name, row.body);
}

// Thin exhibit-id-keyed wrappers for mountManualRefsRoutes
// (@congress/chamber-kit), which only ever sees full Exhibit ids
// ("place-3"), not this Chamber's own row ids.
const manualRefsByExhibitId = createManualRefsByExhibitId(
  { listManualRefs, addManualRef, removeManualRef },
  parsePlaceId
);
export const listManualRefsByExhibitId = manualRefsByExhibitId.listManualRefsByExhibitId;
export const addManualRefByExhibitId = manualRefsByExhibitId.addManualRefByExhibitId;
export const removeManualRefByExhibitId = manualRefsByExhibitId.removeManualRefByExhibitId;

export async function resyncPlaceExhibitByExhibitId(exhibitId: string): Promise<void> {
  const id = parsePlaceId(exhibitId);
  if (id !== null) await resyncPlaceExhibit(id);
}

// The place edit itself is already committed by the time history is rebuilt
// off the back of it, and the rebuild is re-runnable by hand from Settings -
// so a failure there is worth logging, not worth failing the write the
// owner actually asked for.
async function reprocessQuietly(...args: Parameters<typeof reprocessForPlace>): Promise<void> {
  try {
    await reprocessForPlace(...args);
  } catch (error) {
    console.error("[chamber-map] history rebuild after a place change failed:", error);
  }
}

function toSummary(row: typeof places.$inferSelect): PlaceSummary {
  return {
    id: row.id,
    name: row.name,
    body: row.body,
    latitude: row.latitude,
    longitude: row.longitude,
    radiusMeters: row.radiusMeters,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listPlaces(): Promise<PlaceSummary[]> {
  const rows = db.select().from(places).orderBy(desc(places.updatedAt)).all();
  return rows.map(toSummary);
}

// Most recently updated places, capped - powers the homepage widget.
export async function listRecentPlaces(limit = 5): Promise<PlaceSummary[]> {
  const rows = db.select().from(places).orderBy(desc(places.updatedAt)).limit(limit).all();
  return rows.map(toSummary);
}

export async function searchPlaces(query: string): Promise<PlaceSummary[]> {
  const pattern = `%${query}%`;
  const rows = db
    .select()
    .from(places)
    .where(or(like(places.name, pattern), like(places.body, pattern)))
    .orderBy(desc(places.updatedAt))
    .all();
  return rows.map(toSummary);
}

export async function getPlace(id: number): Promise<PlaceDetail | null> {
  const row = db.select().from(places).where(eq(places.id, id)).get();
  return row ? toSummary(row) : null;
}

export interface CreatePlaceOptions {
  // Whether adding this place should re-derive the visits it retroactively
  // explains (see reprocess.ts). Callers that are mid-way through editing a
  // specific visit row pass false: a reprocess deletes and regenerates
  // visits in its range, which would pull the row out from under them -
  // see classifyVisit's save_place branch.
  reprocessHistory?: boolean;
}

export async function createPlace(
  input: CreatePlaceRequest,
  options: CreatePlaceOptions = {}
): Promise<PlaceDetail> {
  const now = new Date();
  const inserted = db
    .insert(places)
    .values({
      name: input.name,
      body: input.body,
      latitude: input.latitude,
      longitude: input.longitude,
      radiusMeters: input.radiusMeters,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  await syncPlaceExhibit(inserted.id, inserted.name, inserted.body);

  // A place is a rule for reading the position log, not just a row - so
  // naming somewhere you've already been should surface those past visits
  // rather than only apply going forward. No-ops when no recorded fix ever
  // fell inside its radius.
  if (options.reprocessHistory ?? true) {
    await reprocessQuietly(inserted);
  }

  return toSummary(inserted);
}

export async function updatePlace(id: number, input: UpdatePlaceRequest): Promise<PlaceDetail | null> {
  const existing = db.select().from(places).where(eq(places.id, id)).get();
  if (!existing) return null;

  const next = {
    name: input.name ?? existing.name,
    body: input.body ?? existing.body,
    latitude: input.latitude ?? existing.latitude,
    longitude: input.longitude ?? existing.longitude,
    radiusMeters: input.radiusMeters ?? existing.radiusMeters,
    updatedAt: new Date(),
  };

  db.update(places).set(next).where(eq(places.id, id)).run();

  await syncPlaceExhibit(id, next.name, next.body);

  // Only geometry changes what the position log means - renaming a place or
  // editing its body doesn't move a single visit, so don't rewrite history
  // for those. Both geometries are passed so a shrunk radius or moved pin
  // also reaches back far enough to drop visits the old shape used to match.
  const geometryChanged =
    next.latitude !== existing.latitude ||
    next.longitude !== existing.longitude ||
    next.radiusMeters !== existing.radiusMeters;
  if (geometryChanged) {
    await reprocessQuietly(next, existing);
  }

  return getPlace(id);
}

export async function deletePlace(id: number): Promise<boolean> {
  const existing = db.select().from(places).where(eq(places.id, id)).get();
  const result = db.delete(places).where(eq(places.id, id)).run();
  if (result.changes > 0 && existing) {
    deleteManualRefsForPlace(id);
    await pushExhibitSync({
      id: toExhibitId(id),
      type: "place",
      name: existing.name,
      url: `/p/${id}`,
      outgoingRefs: [],
      deleted: true,
    });
    // The visits that pointed here are left behind with a null placeId by
    // the FK's ON DELETE SET NULL, which reads as "Unknown location" rather
    // than as the unclassified dwells they've become - replaying turns them
    // back into ordinary pending stops the owner can reclassify.
    await reprocessQuietly(existing);
  }
  return result.changes > 0;
}
