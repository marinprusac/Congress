import { eq } from "drizzle-orm";
import { PRIORITY_LEVELS, type ChamberSubscription, type PriorityLevel } from "@congress/shared-types";
import { db } from "./db/client.js";
import { logRules } from "./db/schema.js";

function loosest(a: PriorityLevel | null, b: PriorityLevel | null): PriorityLevel | null {
  // null means "no threshold at all" - already the loosest possible, wins
  // over any concrete level.
  if (a === null || b === null) return null;
  return PRIORITY_LEVELS.indexOf(a) <= PRIORITY_LEVELS.indexOf(b) ? a : b;
}

// This Chamber's current dynamic event interest list, sent to Congress on
// every heartbeat (see chamber-kit's createCapitolRegistration) - one entry
// per distinct triggerEventType across all *enabled* rules, using the
// loosest (lowest) minPriority among them. Congress uses this only as a
// coarse per-type gate; handleReceivedEvent (eventReceive.ts) still does
// its own precise per-rule minPriorityMatches/conditionMatches check on
// every individually delivered event, exactly as it did when this Chamber
// polled Congress's own log instead of receiving pushes.
export function computeSubscriptions(): ChamberSubscription[] {
  const rows = db
    .select({ triggerEventType: logRules.triggerEventType, minPriority: logRules.minPriority })
    .from(logRules)
    .where(eq(logRules.enabled, true))
    .all();

  const byType = new Map<string, PriorityLevel | null>();
  for (const row of rows) {
    const current = byType.has(row.triggerEventType) ? byType.get(row.triggerEventType)! : undefined;
    byType.set(row.triggerEventType, current === undefined ? row.minPriority : loosest(current, row.minPriority));
  }

  return [...byType.entries()].map(([type, minPriority]) => (minPriority ? { type, minPriority } : { type }));
}

// Set by index.ts once boot has wired up the real heartbeatNow - defaults
// to a no-op so logRules.ts can call this unconditionally without caring
// about boot ordering.
let notify: () => void = () => {};

export function setSubscriptionChangeNotifier(fn: () => void): void {
  notify = fn;
}

// Called after any rule create/update/delete (logRules.ts) so a changed
// subscription list reaches Congress right away instead of waiting for the
// next scheduled heartbeat.
export function notifySubscriptionsChanged(): void {
  notify();
}
