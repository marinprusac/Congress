import { priorityLevelSchema, type EventDelivery, type PriorityLevel } from "@congress/shared-types";
import { getEventSettingsRowByType, markEventSettingsFired } from "./eventSettings.js";
import { pushNotification } from "./notifications.js";
import { recordHistory, priorityRankFor } from "./eventHistory.js";

// Reads a dotted path ("a.b.c") out of a plain object, returning undefined
// for any missing/non-object segment - used by priority extraction and
// template interpolation below.
function getPath(payload: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), payload);
}

// payload.priority is a convention (PRIORITY_LEVELS, shared-types), not
// enforced by Congress - anything missing or unrecognized defaults to
// "normal" rather than rejecting the event.
function priorityOf(payload: Record<string, unknown>): PriorityLevel {
  const parsed = priorityLevelSchema.safeParse(payload.priority);
  return parsed.success ? parsed.data : "normal";
}

// ">=" is deliberately the only comparison a threshold supports - see
// eventSettings table's own comment. "low" (the bottom of PRIORITY_LEVELS)
// already matches every firing, so there's no separate "no threshold" case
// to special-case here.
function priorityMatches(threshold: PriorityLevel, priority: PriorityLevel): boolean {
  return priorityRankFor(priority) >= priorityRankFor(threshold);
}

// Plain {{payload.x}}/{{payload.a.b}} interpolation - no templating library,
// no arbitrary expressions, just a dotted-path lookup against the firing
// event's own payload.
function interpolate(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{\{\s*payload\.([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, path: string) => {
    const value = getPath(payload, path);
    return value === undefined || value === null ? "" : String(value);
  });
}

// Handed to mountEventReceiveRoute (@congress/chamber-kit) - looks up the
// single settings row for this event type (auto-derived by
// eventCatalogSync.ts, one row per type) and runs its two independent
// actions, each gated by its own priority threshold.
export async function handleReceivedEvent(event: EventDelivery): Promise<void> {
  const row = getEventSettingsRowByType(event.type);
  if (!row) return;

  const priority = priorityOf(event.payload);
  let fired = false;

  if (row.recordToHistory && priorityMatches(row.historyMinPriority, priority)) {
    recordHistory({
      chamber: event.chamber,
      type: event.type,
      priority,
      payload: event.payload,
      occurredAt: new Date(event.occurredAt),
      retentionMs: row.historyRetentionMs,
    });
    fired = true;
  }

  if (row.notify && priorityMatches(row.notifyMinPriority, priority)) {
    // The dedupe key template is an optional field the owner rarely fills
    // in - default to a key scoped to this event type so repeat firings
    // still update the one notification in place instead of piling up.
    const dedupeKey = row.notifyDedupeKeyTemplate ? interpolate(row.notifyDedupeKeyTemplate, event.payload) : `type-${row.eventType}`;
    const title = row.notifyTitleTemplate ? interpolate(row.notifyTitleTemplate, event.payload) : row.label;
    const body = row.notifyBodyTemplate ? interpolate(row.notifyBodyTemplate, event.payload) : (row.description ?? undefined);
    const chamberUrl = row.notifyUrlTemplate ? interpolate(row.notifyUrlTemplate, event.payload) : undefined;
    // Preserve the original emitting chamber's identity (e.g. "tasks") so
    // the notification bell attributes/icons it correctly - this Chamber
    // is just the one deciding whether/what to push, not the source.
    pushNotification({ chamber: event.chamber, dedupeKey, title, body, chamberUrl });
    fired = true;
  }

  if (fired) await markEventSettingsFired(event.type);
}
