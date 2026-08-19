import { eq } from "drizzle-orm";
import type { ChamberSubscription } from "@congress/shared-types";
import { db } from "./db/client.js";
import { automations } from "./db/schema.js";

// This Chamber's current dynamic event interest list, sent to Congress on
// every heartbeat (see chamber-kit's createCapitolRegistration) - one entry
// per distinct triggerEventType across all *enabled* automations. Unlike
// Logs Chamber's own rules, an automation has no minPriority field at all
// (see db/schema.ts's automations table), so there's no threshold to
// aggregate here - Congress relays every event of a subscribed type
// regardless of priority, and handleReceivedEvent (eventReceive.ts) does
// its own precise conditionField/conditionEquals check per delivered event,
// exactly as it did when this Chamber polled Congress's own log instead.
export function computeSubscriptions(): ChamberSubscription[] {
  const rows = db.select({ triggerEventType: automations.triggerEventType }).from(automations).where(eq(automations.enabled, true)).all();
  return [...new Set(rows.map((r) => r.triggerEventType))].map((type) => ({ type }));
}

// Set by index.ts once boot has wired up the real heartbeatNow - defaults
// to a no-op so automations.ts can call this unconditionally without caring
// about boot ordering.
let notify: () => void = () => {};

export function setSubscriptionChangeNotifier(fn: () => void): void {
  notify = fn;
}

// Called after any automation create/update/delete (automations.ts) so a
// changed subscription list reaches Congress right away instead of waiting
// for the next scheduled heartbeat.
export function notifySubscriptionsChanged(): void {
  notify();
}
