import { and, desc, eq, isNotNull, like, or } from "drizzle-orm";
import type { DirectiveSummary, DirectiveDetail, CreateDirectiveRequest, UpdateDirectiveRequest } from "./types.js";
import { extractOutgoingExhibitRefs, createManualRefsByExhibitId } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { directives } from "./db/schema.js";
import { toExhibitId, parseDirectiveId, pushExhibitSync } from "./exhibits.js";
import { listManualRefs, addManualRef, removeManualRef, deleteManualRefsForDirective } from "./refs.js";

// The set of Exhibits a directive points at is the union of what's embedded
// in its body ("[[" tokens) and what was added explicitly via the
// References side panel - pushed to Congress as one outgoingRefs list
// either way. Same shape as chamber-notes/src/notes.ts's syncNoteExhibit.
async function syncDirectiveExhibit(id: number, title: string, body: string): Promise<void> {
  const manual = listManualRefs(id);
  const outgoingRefs = new Set([...extractOutgoingExhibitRefs(body), ...manual]);
  await pushExhibitSync({
    id: toExhibitId(id),
    type: "directive",
    name: title,
    url: `/d/${id}`,
    outgoingRefs: [...outgoingRefs],
    manualRefs: manual,
  });
}

// Re-syncs a directive whose body didn't change but whose manual refs did
// (see the /api/exhibits/:id/refs routes in server.ts).
export async function resyncDirectiveExhibit(id: number): Promise<void> {
  const row = db.select().from(directives).where(eq(directives.id, id)).get();
  if (!row) return;
  await syncDirectiveExhibit(id, row.title, row.body);
}

// Thin exhibit-id-keyed wrappers for mountManualRefsRoutes
// (@congress/chamber-kit), which only ever sees full Exhibit ids
// ("directive-3"), not this Chamber's own row ids.
const manualRefsByExhibitId = createManualRefsByExhibitId({ listManualRefs, addManualRef, removeManualRef }, parseDirectiveId);
export const listManualRefsByExhibitId = manualRefsByExhibitId.listManualRefsByExhibitId;
export const addManualRefByExhibitId = manualRefsByExhibitId.addManualRefByExhibitId;
export const removeManualRefByExhibitId = manualRefsByExhibitId.removeManualRefByExhibitId;

export async function resyncDirectiveExhibitByExhibitId(exhibitId: string): Promise<void> {
  const id = parseDirectiveId(exhibitId);
  if (id !== null) await resyncDirectiveExhibit(id);
}

function toSummary(row: typeof directives.$inferSelect): DirectiveSummary {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    enabled: row.enabled,
    intervalMs: row.intervalMs,
    lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Every enabled directive with its own timer set - the pool checkup.ts's
// scheduler picks due directives from and computes the next wake delay
// against. Fetched into JS rather than done with SQL date arithmetic since
// the directive count here is small (a personal system's own standing
// instructions), not worth the query complexity.
async function listEnabledScheduledDirectives(): Promise<DirectiveSummary[]> {
  const rows = db
    .select()
    .from(directives)
    .where(and(eq(directives.enabled, true), isNotNull(directives.intervalMs)))
    .all();
  return rows.map(toSummary);
}

function dueAt(d: DirectiveSummary): number {
  const last = d.lastRunAt ? new Date(d.lastRunAt).getTime() : 0;
  return last + (d.intervalMs as number);
}

// checkup.ts's tick() runs everything this returns, each as its own
// runDeputy call.
export async function listDueScheduledDirectives(): Promise<DirectiveSummary[]> {
  const now = Date.now();
  const rows = await listEnabledScheduledDirectives();
  return rows.filter((d) => dueAt(d) <= now);
}

// Delay in ms until the soonest enabled+scheduled directive comes due, or
// null if none are scheduled at all - checkup.ts leaves its timer unarmed
// in that case rather than polling forever for nothing. Same "one timer for
// the soonest deadline" idiom chamber-tasks uses for due-date checks.
export async function nextScheduledWakeDelayMs(): Promise<number | null> {
  const rows = await listEnabledScheduledDirectives();
  if (rows.length === 0) return null;
  const now = Date.now();
  const soonest = Math.min(...rows.map(dueAt));
  return Math.max(0, soonest - now);
}

// Stamped the moment a scheduled or manual run is kicked off, not when it
// finishes - see db/schema.ts's own comment on why (avoids a slow `claude`
// invocation causing the next tick to re-fire the same directive).
export async function markDirectiveRunNow(id: number): Promise<void> {
  db.update(directives).set({ lastRunAt: new Date() }).where(eq(directives.id, id)).run();
}

export async function listDirectives(): Promise<DirectiveSummary[]> {
  const rows = db.select().from(directives).orderBy(desc(directives.updatedAt)).all();
  return rows.map(toSummary);
}

// Most recently updated directives, capped - powers the homepage widget.
export async function listRecentDirectives(limit = 5): Promise<DirectiveSummary[]> {
  const rows = db.select().from(directives).orderBy(desc(directives.updatedAt)).limit(limit).all();
  return rows.map(toSummary);
}

export async function searchDirectives(query: string): Promise<DirectiveSummary[]> {
  const pattern = `%${query}%`;
  const rows = db
    .select()
    .from(directives)
    .where(or(like(directives.title, pattern), like(directives.body, pattern)))
    .orderBy(desc(directives.updatedAt))
    .all();
  return rows.map(toSummary);
}

// Every enabled directive's title+body, concatenated - Deputy's actual
// mandate, handed to it as context on every headless invocation. See
// promptAssembly.ts.
export async function listEnabledDirectives(): Promise<DirectiveSummary[]> {
  const rows = db.select().from(directives).where(eq(directives.enabled, true)).orderBy(desc(directives.updatedAt)).all();
  return rows.map(toSummary);
}

export async function getDirective(id: number): Promise<DirectiveDetail | null> {
  const row = db.select().from(directives).where(eq(directives.id, id)).get();
  return row ? toSummary(row) : null;
}

export async function createDirective(input: CreateDirectiveRequest): Promise<DirectiveDetail> {
  const now = new Date();
  const inserted = db
    .insert(directives)
    .values({
      title: input.title,
      body: input.body,
      enabled: input.enabled,
      intervalMs: input.intervalMs,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  await syncDirectiveExhibit(inserted.id, inserted.title, inserted.body);

  return toSummary(inserted);
}

export async function updateDirective(id: number, input: UpdateDirectiveRequest): Promise<DirectiveDetail | null> {
  const existing = db.select().from(directives).where(eq(directives.id, id)).get();
  if (!existing) return null;

  const next = {
    title: input.title ?? existing.title,
    body: input.body ?? existing.body,
    enabled: input.enabled ?? existing.enabled,
    // intervalMs can be legitimately set back to null (unschedule), so an
    // absent field (not sent at all) is what falls back to the existing
    // value here - not `?? ` against null.
    intervalMs: input.intervalMs !== undefined ? input.intervalMs : existing.intervalMs,
    updatedAt: new Date(),
  };

  db.update(directives).set(next).where(eq(directives.id, id)).run();

  await syncDirectiveExhibit(id, next.title, next.body);

  return getDirective(id);
}

export async function deleteDirective(id: number): Promise<boolean> {
  const existing = db.select().from(directives).where(eq(directives.id, id)).get();
  const result = db.delete(directives).where(eq(directives.id, id)).run();
  if (result.changes > 0 && existing) {
    deleteManualRefsForDirective(id);
    await pushExhibitSync({
      id: toExhibitId(id),
      type: "directive",
      name: existing.title,
      url: `/d/${id}`,
      outgoingRefs: [],
      deleted: true,
    });
  }
  return result.changes > 0;
}
