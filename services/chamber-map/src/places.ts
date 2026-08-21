import { desc, eq, like, or } from "drizzle-orm";
import type { PlaceSummary, PlaceDetail, CreatePlaceRequest, UpdatePlaceRequest } from "./types.js";
import { extractOutgoingExhibitRefs, createManualRefsByExhibitId } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { places } from "./db/schema.js";
import { toExhibitId, parsePlaceId, pushExhibitSync } from "./exhibits.js";
import { listManualRefs, addManualRef, removeManualRef, deleteManualRefsForPlace } from "./refs.js";

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

function toSummary(row: typeof places.$inferSelect): PlaceSummary {
  return {
    id: row.id,
    name: row.name,
    body: row.body,
    category: row.category,
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

export async function createPlace(input: CreatePlaceRequest): Promise<PlaceDetail> {
  const now = new Date();
  const inserted = db
    .insert(places)
    .values({
      name: input.name,
      body: input.body,
      category: input.category,
      latitude: input.latitude,
      longitude: input.longitude,
      radiusMeters: input.radiusMeters,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  await syncPlaceExhibit(inserted.id, inserted.name, inserted.body);

  return toSummary(inserted);
}

export async function updatePlace(id: number, input: UpdatePlaceRequest): Promise<PlaceDetail | null> {
  const existing = db.select().from(places).where(eq(places.id, id)).get();
  if (!existing) return null;

  const next = {
    name: input.name ?? existing.name,
    body: input.body ?? existing.body,
    category: input.category ?? existing.category,
    latitude: input.latitude ?? existing.latitude,
    longitude: input.longitude ?? existing.longitude,
    radiusMeters: input.radiusMeters ?? existing.radiusMeters,
    updatedAt: new Date(),
  };

  db.update(places).set(next).where(eq(places.id, id)).run();

  await syncPlaceExhibit(id, next.name, next.body);

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
  }
  return result.changes > 0;
}
