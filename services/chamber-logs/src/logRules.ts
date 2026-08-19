import { and, desc, eq, like, or } from "drizzle-orm";
import type { LogRuleSummary, LogRuleDetail, CreateLogRuleRequest, UpdateLogRuleRequest } from "./types.js";
import { extractOutgoingExhibitRefs, createManualRefsByExhibitId } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { logRules } from "./db/schema.js";
import { toExhibitId, parseLogRuleId, pushExhibitSync } from "./exhibits.js";
import { listManualRefs, addManualRef, removeManualRef, deleteManualRefsForLogRule } from "./refs.js";
import { notifySubscriptionsChanged } from "./subscriptions.js";

// The set of Exhibits a log rule points at is the union of what's embedded
// in its body ("[[" tokens) and what was added explicitly via the
// References side panel - pushed to Congress as one outgoingRefs list
// either way. Same shape as chamber-notes/src/notes.ts's syncNoteExhibit.
async function syncLogRuleExhibit(id: number, title: string, body: string): Promise<void> {
  const manual = listManualRefs(id);
  const outgoingRefs = new Set([...extractOutgoingExhibitRefs(body), ...manual]);
  await pushExhibitSync({
    id: toExhibitId(id),
    type: "log-rule",
    name: title,
    url: `/r/${id}`,
    outgoingRefs: [...outgoingRefs],
    manualRefs: manual,
  });
}

// Re-syncs a log rule whose body didn't change but whose manual refs did
// (see the /api/exhibits/:id/refs routes in server.ts).
export async function resyncLogRuleExhibit(id: number): Promise<void> {
  const row = db.select().from(logRules).where(eq(logRules.id, id)).get();
  if (!row) return;
  await syncLogRuleExhibit(id, row.title, row.body);
}

// Thin exhibit-id-keyed wrappers for mountManualRefsRoutes
// (@congress/chamber-kit), which only ever sees full Exhibit ids
// ("logrule-3"), not this Chamber's own row ids.
const manualRefsByExhibitId = createManualRefsByExhibitId({ listManualRefs, addManualRef, removeManualRef }, parseLogRuleId);
export const listManualRefsByExhibitId = manualRefsByExhibitId.listManualRefsByExhibitId;
export const addManualRefByExhibitId = manualRefsByExhibitId.addManualRefByExhibitId;
export const removeManualRefByExhibitId = manualRefsByExhibitId.removeManualRefByExhibitId;

export async function resyncLogRuleExhibitByExhibitId(exhibitId: string): Promise<void> {
  const id = parseLogRuleId(exhibitId);
  if (id !== null) await resyncLogRuleExhibit(id);
}

function toSummary(row: typeof logRules.$inferSelect): LogRuleSummary {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    triggerEventType: row.triggerEventType,
    conditionField: row.conditionField,
    conditionEquals: row.conditionEquals,
    minPriority: row.minPriority,
    recordToHistory: row.recordToHistory,
    historyRetentionMs: row.historyRetentionMs,
    notify: row.notify,
    notifyTitleTemplate: row.notifyTitleTemplate,
    notifyBodyTemplate: row.notifyBodyTemplate,
    notifyUrlTemplate: row.notifyUrlTemplate,
    notifyDedupeKeyTemplate: row.notifyDedupeKeyTemplate,
    enabled: row.enabled,
    lastFiredAt: row.lastFiredAt ? row.lastFiredAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listLogRules(): Promise<LogRuleSummary[]> {
  const rows = db.select().from(logRules).orderBy(desc(logRules.updatedAt)).all();
  return rows.map(toSummary);
}

// Most recently updated rules, capped - powers the homepage widget.
export async function listRecentLogRules(limit = 5): Promise<LogRuleSummary[]> {
  const rows = db.select().from(logRules).orderBy(desc(logRules.updatedAt)).limit(limit).all();
  return rows.map(toSummary);
}

export async function searchLogRules(query: string): Promise<LogRuleSummary[]> {
  const pattern = `%${query}%`;
  const rows = db
    .select()
    .from(logRules)
    .where(or(like(logRules.title, pattern), like(logRules.body, pattern)))
    .orderBy(desc(logRules.updatedAt))
    .all();
  return rows.map(toSummary);
}

// Rules whose trigger matches the given event type - what eventPoller.ts
// actually queries on each new event. Disabled rules are excluded here (not
// just skipped at execution time) so a disabled rule never even shows up as
// "matched" in any future debug tooling.
export function listEnabledLogRulesForTrigger(triggerEventType: string): (typeof logRules.$inferSelect)[] {
  return db
    .select()
    .from(logRules)
    .where(and(eq(logRules.triggerEventType, triggerEventType), eq(logRules.enabled, true)))
    .all();
}

export async function getLogRule(id: number): Promise<LogRuleDetail | null> {
  const row = db.select().from(logRules).where(eq(logRules.id, id)).get();
  return row ? toSummary(row) : null;
}

export async function createLogRule(input: CreateLogRuleRequest): Promise<LogRuleDetail> {
  const now = new Date();
  const inserted = db
    .insert(logRules)
    .values({
      title: input.title,
      body: input.body,
      triggerEventType: input.triggerEventType,
      conditionField: input.conditionField ?? null,
      conditionEquals: input.conditionEquals ?? null,
      minPriority: input.minPriority ?? null,
      recordToHistory: input.recordToHistory,
      historyRetentionMs: input.historyRetentionMs ?? null,
      notify: input.notify,
      notifyTitleTemplate: input.notifyTitleTemplate ?? null,
      notifyBodyTemplate: input.notifyBodyTemplate ?? null,
      notifyUrlTemplate: input.notifyUrlTemplate ?? null,
      notifyDedupeKeyTemplate: input.notifyDedupeKeyTemplate ?? null,
      enabled: input.enabled,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  await syncLogRuleExhibit(inserted.id, inserted.title, inserted.body);
  notifySubscriptionsChanged();

  return toSummary(inserted);
}

export async function updateLogRule(id: number, input: UpdateLogRuleRequest): Promise<LogRuleDetail | null> {
  const existing = db.select().from(logRules).where(eq(logRules.id, id)).get();
  if (!existing) return null;

  const next = {
    title: input.title ?? existing.title,
    body: input.body ?? existing.body,
    triggerEventType: input.triggerEventType ?? existing.triggerEventType,
    conditionField: input.conditionField !== undefined ? input.conditionField : existing.conditionField,
    conditionEquals: input.conditionEquals !== undefined ? input.conditionEquals : existing.conditionEquals,
    minPriority: input.minPriority !== undefined ? input.minPriority : existing.minPriority,
    recordToHistory: input.recordToHistory ?? existing.recordToHistory,
    historyRetentionMs: input.historyRetentionMs !== undefined ? input.historyRetentionMs : existing.historyRetentionMs,
    notify: input.notify ?? existing.notify,
    notifyTitleTemplate: input.notifyTitleTemplate !== undefined ? input.notifyTitleTemplate : existing.notifyTitleTemplate,
    notifyBodyTemplate: input.notifyBodyTemplate !== undefined ? input.notifyBodyTemplate : existing.notifyBodyTemplate,
    notifyUrlTemplate: input.notifyUrlTemplate !== undefined ? input.notifyUrlTemplate : existing.notifyUrlTemplate,
    notifyDedupeKeyTemplate:
      input.notifyDedupeKeyTemplate !== undefined ? input.notifyDedupeKeyTemplate : existing.notifyDedupeKeyTemplate,
    enabled: input.enabled ?? existing.enabled,
    updatedAt: new Date(),
  };

  db.update(logRules).set(next).where(eq(logRules.id, id)).run();

  await syncLogRuleExhibit(id, next.title, next.body);
  notifySubscriptionsChanged();

  return getLogRule(id);
}

export async function deleteLogRule(id: number): Promise<boolean> {
  const existing = db.select().from(logRules).where(eq(logRules.id, id)).get();
  const result = db.delete(logRules).where(eq(logRules.id, id)).run();
  if (result.changes > 0 && existing) {
    deleteManualRefsForLogRule(id);
    await pushExhibitSync({
      id: toExhibitId(id),
      type: "log-rule",
      name: existing.title,
      url: `/r/${id}`,
      outgoingRefs: [],
      deleted: true,
    });
    notifySubscriptionsChanged();
  }
  return result.changes > 0;
}

export async function markLogRuleFired(id: number): Promise<void> {
  db.update(logRules).set({ lastFiredAt: new Date() }).where(eq(logRules.id, id)).run();
}
