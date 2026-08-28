import { and, desc, eq, like, or } from "drizzle-orm";
import type { AutomationSummary, AutomationDetail, AutomationRun, CreateAutomationRequest, UpdateAutomationRequest } from "./types.js";
import { extractOutgoingExhibitRefs, createManualRefsByExhibitId } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { automations, automationRuns } from "./db/schema.js";
import { toExhibitId, parseAutomationId, pushExhibitSync } from "./exhibits.js";
import { listManualRefs, addManualRef, removeManualRef, deleteManualRefsForAutomation } from "./refs.js";
import { notifySubscriptionsChanged } from "./subscriptions.js";
import { publishEvent } from "./events.js";

// The set of Exhibits an automation points at is the union of what's
// embedded in its body ("[[" tokens) and what was added explicitly via the
// References side panel - pushed to Congress as one outgoingRefs list
// either way. Same shape as chamber-notes/src/notes.ts's syncNoteExhibit.
async function syncAutomationExhibit(id: number, title: string, body: string): Promise<void> {
  const manual = listManualRefs(id);
  const outgoingRefs = new Set([...extractOutgoingExhibitRefs(body), ...manual]);
  await pushExhibitSync({
    id: toExhibitId(id),
    type: "automation",
    name: title,
    url: `/a/${id}`,
    outgoingRefs: [...outgoingRefs],
    manualRefs: manual,
  });
}

// Re-syncs an automation whose body didn't change but whose manual refs did
// (see the /api/exhibits/:id/refs routes in server.ts).
export async function resyncAutomationExhibit(id: number): Promise<void> {
  const row = db.select().from(automations).where(eq(automations.id, id)).get();
  if (!row) return;
  await syncAutomationExhibit(id, row.title, row.body);
}

// Thin exhibit-id-keyed wrappers for mountManualRefsRoutes
// (@congress/chamber-kit), which only ever sees full Exhibit ids
// ("automation-3"), not this Chamber's own row ids.
const manualRefsByExhibitId = createManualRefsByExhibitId({ listManualRefs, addManualRef, removeManualRef }, parseAutomationId);
export const listManualRefsByExhibitId = manualRefsByExhibitId.listManualRefsByExhibitId;
export const addManualRefByExhibitId = manualRefsByExhibitId.addManualRefByExhibitId;
export const removeManualRefByExhibitId = manualRefsByExhibitId.removeManualRefByExhibitId;

export async function resyncAutomationExhibitByExhibitId(exhibitId: string): Promise<void> {
  const id = parseAutomationId(exhibitId);
  if (id !== null) await resyncAutomationExhibit(id);
}

function toSummary(row: typeof automations.$inferSelect): AutomationSummary {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    triggerEventType: row.triggerEventType,
    conditionField: row.conditionField,
    conditionEquals: row.conditionEquals,
    targetChamber: row.targetChamber,
    toolName: row.toolName,
    argsTemplate: JSON.parse(row.argsTemplateJson),
    enabled: row.enabled,
    lastFiredAt: row.lastFiredAt ? row.lastFiredAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listAutomations(): Promise<AutomationSummary[]> {
  const rows = db.select().from(automations).orderBy(desc(automations.updatedAt)).all();
  return rows.map(toSummary);
}

// Most recently updated automations, capped - powers the homepage widget.
export async function listRecentAutomations(limit = 5): Promise<AutomationSummary[]> {
  const rows = db.select().from(automations).orderBy(desc(automations.updatedAt)).limit(limit).all();
  return rows.map(toSummary);
}

export async function searchAutomations(query: string): Promise<AutomationSummary[]> {
  const pattern = `%${query}%`;
  const rows = db
    .select()
    .from(automations)
    .where(or(like(automations.title, pattern), like(automations.body, pattern)))
    .orderBy(desc(automations.updatedAt))
    .all();
  return rows.map(toSummary);
}

// Automations whose trigger matches the given event type - what
// eventPoller.ts actually queries on each new event. Disabled automations
// are excluded here (not just skipped at execution time) so a disabled
// automation never even shows up as "matched" in any future debug tooling.
export function listEnabledAutomationsForTrigger(triggerEventType: string): (typeof automations.$inferSelect)[] {
  return db
    .select()
    .from(automations)
    .where(and(eq(automations.triggerEventType, triggerEventType), eq(automations.enabled, true)))
    .all();
}

export async function getAutomation(id: number): Promise<AutomationDetail | null> {
  const row = db.select().from(automations).where(eq(automations.id, id)).get();
  return row ? toSummary(row) : null;
}

export async function createAutomation(input: CreateAutomationRequest): Promise<AutomationDetail> {
  const now = new Date();
  const inserted = db
    .insert(automations)
    .values({
      title: input.title,
      body: input.body,
      triggerEventType: input.triggerEventType,
      conditionField: input.conditionField ?? null,
      conditionEquals: input.conditionEquals ?? null,
      targetChamber: input.targetChamber,
      toolName: input.toolName,
      argsTemplateJson: JSON.stringify(input.argsTemplate),
      enabled: input.enabled,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  await syncAutomationExhibit(inserted.id, inserted.title, inserted.body);
  notifySubscriptionsChanged();
  void publishEvent({
    type: "automation.created",
    payload: { automationId: inserted.id, title: inserted.title, priority: "low" },
  });

  return toSummary(inserted);
}

export async function updateAutomation(id: number, input: UpdateAutomationRequest): Promise<AutomationDetail | null> {
  const existing = db.select().from(automations).where(eq(automations.id, id)).get();
  if (!existing) return null;

  const next = {
    title: input.title ?? existing.title,
    body: input.body ?? existing.body,
    triggerEventType: input.triggerEventType ?? existing.triggerEventType,
    conditionField: input.conditionField !== undefined ? input.conditionField : existing.conditionField,
    conditionEquals: input.conditionEquals !== undefined ? input.conditionEquals : existing.conditionEquals,
    targetChamber: input.targetChamber ?? existing.targetChamber,
    toolName: input.toolName ?? existing.toolName,
    argsTemplateJson: input.argsTemplate !== undefined ? JSON.stringify(input.argsTemplate) : existing.argsTemplateJson,
    enabled: input.enabled ?? existing.enabled,
    updatedAt: new Date(),
  };

  db.update(automations).set(next).where(eq(automations.id, id)).run();

  await syncAutomationExhibit(id, next.title, next.body);
  notifySubscriptionsChanged();
  void publishEvent({ type: "automation.updated", payload: { automationId: id, title: next.title, priority: "low" } });

  return getAutomation(id);
}

export async function deleteAutomation(id: number): Promise<boolean> {
  const existing = db.select().from(automations).where(eq(automations.id, id)).get();
  const result = db.delete(automations).where(eq(automations.id, id)).run();
  if (result.changes > 0 && existing) {
    deleteManualRefsForAutomation(id);
    await pushExhibitSync({
      id: toExhibitId(id),
      type: "automation",
      name: existing.title,
      url: `/a/${id}`,
      outgoingRefs: [],
      deleted: true,
    });
    notifySubscriptionsChanged();
    void publishEvent({
      type: "automation.deleted",
      payload: { automationId: id, title: existing.title, priority: "low" },
    });
  }
  return result.changes > 0;
}

export async function markAutomationFired(id: number): Promise<void> {
  db.update(automations).set({ lastFiredAt: new Date() }).where(eq(automations.id, id)).run();
}

const RUNS_LIST_LIMIT = 20;

export async function listAutomationRuns(automationId: number): Promise<AutomationRun[]> {
  const rows = db
    .select()
    .from(automationRuns)
    .where(eq(automationRuns.automationId, automationId))
    .orderBy(desc(automationRuns.firedAt))
    .limit(RUNS_LIST_LIMIT)
    .all();
  return rows.map((row) => ({
    id: row.id,
    automationId: row.automationId,
    payload: JSON.parse(row.payloadJson),
    targetChamber: row.targetChamber,
    toolName: row.toolName,
    ok: row.ok,
    result: row.resultJson ? JSON.parse(row.resultJson) : null,
    errorMessage: row.errorMessage,
    firedAt: row.firedAt.toISOString(),
  }));
}
