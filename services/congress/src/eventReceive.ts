import type { EventDelivery } from "@congress/shared-types";
// interpolate is shared with chamber-automation (and Congress's own relay
// filter) rather than re-declared here - see chamber-kit's eventMatching.ts.
import { interpolate } from "./kit/interpolate.js";
import { getEventSettingsRowByType, markEventSettingsFired, resolveNotify } from "./eventSettings.js";
import { pushNotification } from "./notifications.js";
import { recordHistory } from "./eventHistory.js";

// An event-driven notification is a moment, not a record: it leaves the inbox
// at the payload's `staleAt` (epoch ms; null = until something else clears it)
// or, absent that, after a day.
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export function expiryFor(payload: Record<string, unknown>, now = Date.now()): Date | null {
  const stale = payload.staleAt;
  if (stale === null) return null;
  if (typeof stale === "number" && Number.isFinite(stale)) return new Date(stale);
  return new Date(now + DEFAULT_TTL_MS);
}

// Handed to mountEventReceiveRoute (@congress/chamber-kit) - looks up the
// single settings row for this event type (auto-derived by
// eventCatalogSync.ts, one row per type) and runs its two independent
// actions.
export async function handleReceivedEvent(event: EventDelivery): Promise<void> {
  const row = getEventSettingsRowByType(event.type);
  if (!row) return;

  // Every event is recorded, always; only the push is configurable.
  recordHistory({
    chamber: event.chamber,
    type: event.type,
    payload: event.payload,
    actor: event.actor,
    occurredAt: new Date(event.occurredAt),
    retentionMs: row.historyRetentionMs,
  });

  const n = resolveNotify(row);
  if (n.notify) {
    // The dedupe key template is an optional field the owner rarely fills
    // in - default to a key scoped to this event type so repeat firings
    // still update the one notification in place instead of piling up.
    const dedupeKey = n.dedupeKeyTemplate ? interpolate(n.dedupeKeyTemplate, event.payload) : `type-${row.eventType}`;
    const title = n.titleTemplate ? interpolate(n.titleTemplate, event.payload) : row.label;
    const body = n.bodyTemplate ? interpolate(n.bodyTemplate, event.payload) : (row.description ?? undefined);
    const chamberUrl = n.urlTemplate ? interpolate(n.urlTemplate, event.payload) : undefined;
    // Preserve the original emitting chamber's identity (e.g. "tasks") so
    // the notification bell attributes/icons it correctly - this Chamber
    // is just the one deciding whether/what to push, not the source.
    const expiresAt = expiryFor(event.payload);
    // Already stale on arrival (the moment passed): nothing to show.
    if (expiresAt && expiresAt.getTime() <= Date.now()) return void (await markEventSettingsFired(event.type));
    pushNotification({ chamber: event.chamber, dedupeKey, title, body, chamberUrl }, { expiresAt });
  }

  await markEventSettingsFired(event.type);
}
