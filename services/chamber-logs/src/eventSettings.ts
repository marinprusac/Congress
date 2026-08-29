import { asc, eq } from "drizzle-orm";
import type { EventSettingsSummary, UpdateEventSettingsRequest } from "./types.js";
import { db } from "./db/client.js";
import { eventSettings } from "./db/schema.js";
import { notifySubscriptionsChanged } from "./subscriptions.js";
import { publishEvent } from "./events.js";

function toSummary(row: typeof eventSettings.$inferSelect): EventSettingsSummary {
  return {
    id: row.id,
    eventType: row.eventType,
    chamber: row.chamber,
    label: row.label,
    description: row.description,
    recordToHistory: row.recordToHistory,
    historyRetentionMs: row.historyRetentionMs,
    notify: row.notify,
    notifyTitleTemplate: row.notifyTitleTemplate,
    notifyBodyTemplate: row.notifyBodyTemplate,
    notifyUrlTemplate: row.notifyUrlTemplate,
    notifyDedupeKeyTemplate: row.notifyDedupeKeyTemplate,
    lastFiredAt: row.lastFiredAt ? row.lastFiredAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listEventSettings(): Promise<EventSettingsSummary[]> {
  const rows = db.select().from(eventSettings).orderBy(asc(eventSettings.chamber), asc(eventSettings.label)).all();
  return rows.map(toSummary);
}

// What eventReceive.ts actually queries on each delivered event - the raw
// row, not the serialized summary, since it needs the Date-typed
// lastFiredAt/thresholds as-is.
export function getEventSettingsRowByType(eventType: string): typeof eventSettings.$inferSelect | undefined {
  return db.select().from(eventSettings).where(eq(eventSettings.eventType, eventType)).get();
}

export async function getEventSettingsByType(eventType: string): Promise<EventSettingsSummary | null> {
  const row = getEventSettingsRowByType(eventType);
  return row ? toSummary(row) : null;
}

// The only mutator this Chamber exposes - there is deliberately no
// create/delete: every row is auto-derived from the live Chamber registry
// by eventCatalogSync.ts. `input` is limited to the owner-editable subset
// (see UpdateEventSettingsRequest) - eventType/chamber/label/description
// are read-only, cache-refreshed fields.
export async function updateEventSettings(eventType: string, input: UpdateEventSettingsRequest): Promise<EventSettingsSummary | null> {
  const existing = getEventSettingsRowByType(eventType);
  if (!existing) return null;

  const next = {
    recordToHistory: input.recordToHistory ?? existing.recordToHistory,
    historyRetentionMs: input.historyRetentionMs !== undefined ? input.historyRetentionMs : existing.historyRetentionMs,
    notify: input.notify ?? existing.notify,
    notifyTitleTemplate: input.notifyTitleTemplate !== undefined ? input.notifyTitleTemplate : existing.notifyTitleTemplate,
    notifyBodyTemplate: input.notifyBodyTemplate !== undefined ? input.notifyBodyTemplate : existing.notifyBodyTemplate,
    notifyUrlTemplate: input.notifyUrlTemplate !== undefined ? input.notifyUrlTemplate : existing.notifyUrlTemplate,
    notifyDedupeKeyTemplate:
      input.notifyDedupeKeyTemplate !== undefined ? input.notifyDedupeKeyTemplate : existing.notifyDedupeKeyTemplate,
    updatedAt: new Date(),
  };

  db.update(eventSettings).set(next).where(eq(eventSettings.eventType, eventType)).run();
  notifySubscriptionsChanged();
  void publishEvent({ type: "logs.rule_updated", payload: { eventType, label: existing.label } });

  return getEventSettingsByType(eventType);
}

export async function markEventSettingsFired(eventType: string): Promise<void> {
  db.update(eventSettings).set({ lastFiredAt: new Date() }).where(eq(eventSettings.eventType, eventType)).run();
}
