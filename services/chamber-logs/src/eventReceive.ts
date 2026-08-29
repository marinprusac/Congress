import type { EventDelivery } from "@congress/shared-types";
// interpolate is shared with chamber-automation (and Congress's own relay
// filter) rather than re-declared here - see chamber-kit's eventMatching.ts.
import { interpolate } from "@congress/chamber-kit";
import { getEventSettingsRowByType, markEventSettingsFired } from "./eventSettings.js";
import { pushNotification } from "./notifications.js";
import { recordHistory } from "./eventHistory.js";

// Handed to mountEventReceiveRoute (@congress/chamber-kit) - looks up the
// single settings row for this event type (auto-derived by
// eventCatalogSync.ts, one row per type) and runs its two independent
// actions.
export async function handleReceivedEvent(event: EventDelivery): Promise<void> {
  const row = getEventSettingsRowByType(event.type);
  if (!row) return;

  let fired = false;

  if (row.recordToHistory) {
    recordHistory({
      chamber: event.chamber,
      type: event.type,
      payload: event.payload,
      occurredAt: new Date(event.occurredAt),
      retentionMs: row.historyRetentionMs,
    });
    fired = true;
  }

  if (row.notify) {
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
