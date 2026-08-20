import { or, eq } from "drizzle-orm";
import { PRIORITY_LEVELS, type ChamberSubscription, type PriorityLevel } from "@congress/shared-types";
import { db } from "./db/client.js";
import { eventSettings } from "./db/schema.js";

function loosest(a: PriorityLevel | null, b: PriorityLevel | null): PriorityLevel | null {
  // null means "no threshold at all" - already the loosest possible, wins
  // over any concrete level.
  if (a === null || b === null) return null;
  return PRIORITY_LEVELS.indexOf(a) <= PRIORITY_LEVELS.indexOf(b) ? a : b;
}

// This Chamber's current dynamic event interest list, sent to Congress on
// every heartbeat (see chamber-kit's createCapitolRegistration) - one entry
// per event type with at least one active action (recordToHistory or
// notify), using the loosest of whichever thresholds are actually active
// for that row. Congress uses this only as a coarse per-type gate;
// handleReceivedEvent (eventReceive.ts) still does its own precise
// per-action priorityMatches check on every individually delivered event.
export function computeSubscriptions(): ChamberSubscription[] {
  const rows = db
    .select({
      eventType: eventSettings.eventType,
      recordToHistory: eventSettings.recordToHistory,
      historyMinPriority: eventSettings.historyMinPriority,
      notify: eventSettings.notify,
      notifyMinPriority: eventSettings.notifyMinPriority,
    })
    .from(eventSettings)
    .where(or(eq(eventSettings.recordToHistory, true), eq(eventSettings.notify, true)))
    .all();

  return rows.map((row) => {
    const active: (PriorityLevel | null)[] = [];
    if (row.recordToHistory) active.push(row.historyMinPriority);
    if (row.notify) active.push(row.notifyMinPriority);
    const minPriority = active.reduce<PriorityLevel | null>((acc, cur) => loosest(acc, cur), active[0] ?? null);
    return minPriority ? { type: row.eventType, minPriority } : { type: row.eventType };
  });
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
