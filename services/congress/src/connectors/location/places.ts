import { eq } from "drizzle-orm";
import { locationDb as db } from "./db/client.js";
import { places, visits } from "./db/schema.js";
import type { PlaceSummary } from "./types.js";

// The connector's mirror of the owner's Place records: what tracking matches
// fixes against. Kept current from record changes (see index.ts).

export async function listPlaces(): Promise<PlaceSummary[]> {
  return db.select().from(places).all();
}

export const getPlace = (id: string) => db.select().from(places).where(eq(places.id, id)).get();

type Geometry = { latitude: number; longitude: number; radiusMeters: number };

// Stores a place; returns the previous geometry when that changed (history needs a rebuild).
export function upsertPlace(p: PlaceSummary): { geometryChanged: boolean; previous?: Geometry } {
  const before = getPlace(p.id);
  const row = { ...p, updatedAt: new Date() };
  db.insert(places).values(row).onConflictDoUpdate({ target: places.id, set: row }).run();
  if (!before) return { geometryChanged: true };
  const changed = before.latitude !== p.latitude || before.longitude !== p.longitude || before.radiusMeters !== p.radiusMeters;
  return { geometryChanged: changed, previous: before };
}

// Visits there lose their place (they read as unknown until history is rebuilt).
export function removePlace(id: string): Geometry | null {
  const before = getPlace(id);
  if (!before) return null;
  db.transaction((tx) => {
    tx.update(visits).set({ placeId: null, updatedAt: new Date() }).where(eq(visits.placeId, id)).run();
    tx.delete(places).where(eq(places.id, id)).run();
  });
  return before;
}
