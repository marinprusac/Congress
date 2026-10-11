import { asc, eq } from "drizzle-orm";
import type { EventSettingsSummary, UpdateEventSettingsRequest } from "@congress/shared-types";
import { db } from "./db/client.js";
import { eventSettings } from "./db/schema.js";
import { publishEvent } from "./events.js";
import { listTypes } from "./typeEngine/store.js";

export interface NotifyConfig {
  managedByType: string | null;
  notify: boolean;
  titleTemplate: string | null;
  bodyTemplate: string | null;
  urlTemplate: string | null;
  dedupeKeyTemplate: string | null;
}

// An exhibit type's events are configured in its definition (eventNotifications);
// every other event type keeps its own columns here.
export function resolveNotify(row: typeof eventSettings.$inferSelect): NotifyConfig {
  if (row.chamber === "types") {
    for (const t of listTypes({ includeHidden: true })) {
      const prefix = `${t.definition.eventPrefix}.`;
      if (!row.eventType.startsWith(prefix)) continue;
      const entry = t.definition.eventNotifications.find((n) => n.event === row.eventType.slice(prefix.length));
      return {
        managedByType: t.definition.slug,
        notify: !!entry,
        titleTemplate: entry?.title ?? null,
        bodyTemplate: entry?.body ?? "{{payload.title}}",
        urlTemplate: "{{payload.url}}",
        dedupeKeyTemplate: `${row.eventType}-{{payload.recordId}}`,
      };
    }
  }
  return {
    managedByType: null,
    notify: row.notify,
    titleTemplate: row.notifyTitleTemplate,
    bodyTemplate: row.notifyBodyTemplate,
    urlTemplate: row.notifyUrlTemplate,
    dedupeKeyTemplate: row.notifyDedupeKeyTemplate,
  };
}

function toSummary(row: typeof eventSettings.$inferSelect): EventSettingsSummary {
  const n = resolveNotify(row);
  return {
    id: row.id,
    eventType: row.eventType,
    chamber: row.chamber,
    label: row.label,
    description: row.description,
    payloadFields: row.payloadFieldsJson ? JSON.parse(row.payloadFieldsJson) : null,
    historyRetentionMs: row.historyRetentionMs,
    managedByType: n.managedByType,
    notify: n.notify,
    notifyTitleTemplate: n.titleTemplate,
    notifyBodyTemplate: n.bodyTemplate,
    notifyUrlTemplate: n.urlTemplate,
    notifyDedupeKeyTemplate: n.dedupeKeyTemplate,
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

// The only mutator exposed - there is deliberately no
// create/delete: every row is auto-derived from the live Chamber registry
// by eventCatalogSync.ts. `input` is limited to the owner-editable subset
// (see UpdateEventSettingsRequest) - eventType/chamber/label/description
// are read-only, cache-refreshed fields.
export async function updateEventSettings(eventType: string, input: UpdateEventSettingsRequest): Promise<EventSettingsSummary | null> {
  const existing = getEventSettingsRowByType(eventType);
  if (!existing) return null;

  // A type's events notify per its definition, never from these columns.
  const managed = resolveNotify(existing).managedByType !== null;
  if (managed) {
    input = input.historyRetentionMs !== undefined ? { historyRetentionMs: input.historyRetentionMs } : {};
  }

  const next = {
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
  publishEvent({ chamber: "congress", type: "logs.rule_updated", payload: { eventType, label: existing.label } });

  return getEventSettingsByType(eventType);
}

export async function markEventSettingsFired(eventType: string): Promise<void> {
  db.update(eventSettings).set({ lastFiredAt: new Date() }).where(eq(eventSettings.eventType, eventType)).run();
}
