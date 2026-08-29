import { or, eq } from "drizzle-orm";
import type { ChamberSubscription } from "@congress/shared-types";
import { db } from "./db/client.js";
import { eventSettings } from "./db/schema.js";

// This Chamber's current dynamic event interest list, sent to Congress on
// every heartbeat (see chamber-kit's createCapitolRegistration) - one entry
// per event type with at least one active action (recordToHistory or
// notify). Congress uses this only as a coarse per-type gate;
// handleReceivedEvent (eventReceive.ts) still does its own precise
// per-action check on every individually delivered event.
export function computeSubscriptions(): ChamberSubscription[] {
  const rows = db
    .select({ eventType: eventSettings.eventType })
    .from(eventSettings)
    .where(or(eq(eventSettings.recordToHistory, true), eq(eventSettings.notify, true)))
    .all();

  return rows.map((row) => ({ type: row.eventType }));
}

// Set by index.ts once boot has wired up the real heartbeatNow - defaults
// to a no-op so eventSettings.ts/eventCatalogSync.ts can call this
// unconditionally without caring about boot ordering.
let notify: () => void = () => {};

export function setSubscriptionChangeNotifier(fn: () => void): void {
  notify = fn;
}

// Called after any settings update (eventSettings.ts) or newly-discovered
// event type (eventCatalogSync.ts) so a changed subscription list reaches
// Congress right away instead of waiting for the next scheduled heartbeat.
export function notifySubscriptionsChanged(): void {
  notify();
}
