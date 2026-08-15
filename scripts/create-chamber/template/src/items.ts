import { desc, eq, like, or } from "drizzle-orm";
import type { ItemSummary, ItemDetail, CreateItemRequest, UpdateItemRequest } from "./types.js";
import { extractOutgoingExhibitRefs, createManualRefsByExhibitId } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { items } from "./db/schema.js";
import { toExhibitId, parseItemId, pushExhibitSync } from "./exhibits.js";
import { listManualRefs, addManualRef, removeManualRef, deleteManualRefsForItem } from "./refs.js";

// The set of Exhibits this item points at is the union of what's embedded
// in its body ("[[" tokens) and what was added explicitly via the
// References side panel - pushed to Capitol as one outgoingRefs list
// either way. Same shape as chamber-notes/src/notes.ts's syncNoteExhibit.
async function syncItemExhibit(id: number, name: string, body: string): Promise<void> {
  const manual = listManualRefs(id);
  const outgoingRefs = new Set([...extractOutgoingExhibitRefs(body), ...manual]);
  await pushExhibitSync({
    id: toExhibitId(id),
    type: "item",
    name,
    url: `/i/${id}`,
    outgoingRefs: [...outgoingRefs],
    manualRefs: manual,
  });
}

// Re-syncs an item whose body didn't change but whose manual refs did (see
// the /api/exhibits/:id/refs routes in server.ts).
export async function resyncItemExhibit(id: number): Promise<void> {
  const row = db.select().from(items).where(eq(items.id, id)).get();
  if (!row) return;
  await syncItemExhibit(id, row.name, row.body);
}

// Thin exhibit-id-keyed wrappers for mountManualRefsRoutes
// (@congress/chamber-kit), which only ever sees full Exhibit ids
// ("item-3"), not this Chamber's own row ids.
const manualRefsByExhibitId = createManualRefsByExhibitId(
  { listManualRefs, addManualRef, removeManualRef },
  parseItemId
);
export const listManualRefsByExhibitId = manualRefsByExhibitId.listManualRefsByExhibitId;
export const addManualRefByExhibitId = manualRefsByExhibitId.addManualRefByExhibitId;
export const removeManualRefByExhibitId = manualRefsByExhibitId.removeManualRefByExhibitId;

export async function resyncItemExhibitByExhibitId(exhibitId: string): Promise<void> {
  const id = parseItemId(exhibitId);
  if (id !== null) await resyncItemExhibit(id);
}

function toSummary(row: typeof items.$inferSelect): ItemSummary {
  return {
    id: row.id,
    name: row.name,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listItems(): Promise<ItemSummary[]> {
  const rows = db.select().from(items).orderBy(desc(items.updatedAt)).all();
  return rows.map(toSummary);
}

// Most recently updated items, capped - powers the homepage widget.
export async function listRecentItems(limit = 5): Promise<ItemSummary[]> {
  const rows = db.select().from(items).orderBy(desc(items.updatedAt)).limit(limit).all();
  return rows.map(toSummary);
}

export async function searchItems(query: string): Promise<ItemSummary[]> {
  const pattern = `%${query}%`;
  const rows = db
    .select()
    .from(items)
    .where(or(like(items.name, pattern), like(items.body, pattern)))
    .orderBy(desc(items.updatedAt))
    .all();
  return rows.map(toSummary);
}

export async function getItem(id: number): Promise<ItemDetail | null> {
  const row = db.select().from(items).where(eq(items.id, id)).get();
  return row ? toSummary(row) : null;
}

export async function createItem(input: CreateItemRequest): Promise<ItemDetail> {
  const now = new Date();
  const inserted = db
    .insert(items)
    .values({
      name: input.name,
      body: input.body,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  await syncItemExhibit(inserted.id, inserted.name, inserted.body);

  return toSummary(inserted);
}

export async function updateItem(id: number, input: UpdateItemRequest): Promise<ItemDetail | null> {
  const existing = db.select().from(items).where(eq(items.id, id)).get();
  if (!existing) return null;

  const next = {
    name: input.name ?? existing.name,
    body: input.body ?? existing.body,
    updatedAt: new Date(),
  };

  db.update(items).set(next).where(eq(items.id, id)).run();

  await syncItemExhibit(id, next.name, next.body);

  return getItem(id);
}

export async function deleteItem(id: number): Promise<boolean> {
  const existing = db.select().from(items).where(eq(items.id, id)).get();
  const result = db.delete(items).where(eq(items.id, id)).run();
  if (result.changes > 0 && existing) {
    deleteManualRefsForItem(id);
    await pushExhibitSync({
      id: toExhibitId(id),
      type: "item",
      name: existing.name,
      url: `/i/${id}`,
      outgoingRefs: [],
      deleted: true,
    });
  }
  return result.changes > 0;
}
