import type { EventPublishRequest, PriorityLevel, ChamberSubscription } from "@congress/shared-types";
// The same priority vocabulary every subscribing Chamber matches against -
// see chamber-kit's eventMatching.ts. Congress's filter has to agree with
// theirs exactly, since a mismatch here means a Chamber's own rules never
// get the chance to run at all.
import { priorityAtLeast, priorityOf } from "@congress/chamber-kit";
import { listChambers, getChamber } from "./registry.js";
import { env } from "./env.js";

// A publish is retried against a briefly-unreachable Chamber with
// increasing delays rather than given up on immediately - a redeploy
// restarts every service together (infra/deploy/sync-deploy.sh) and can
// leave a Chamber briefly down for well over the first few attempts here.
// Purely in-memory (a chain of setTimeouts within this one background
// task) - no durable queue. If Congress itself restarts mid-retry, or the
// target Chamber is still down past the last attempt, that one delivery is
// silently dropped; the publishing Chamber never learns either way, same
// "best-effort, fire-and-forget" contract createPublishEvent already has
// from the publisher's own side.
const RETRY_DELAYS_MS = [0, 5_000, 15_000, 30_000, 90_000];
const DELIVERY_TIMEOUT_MS = 5_000;

// Coarse per-chamber gate: does this Chamber's own declared interest list
// (carried on its heartbeat - see registry.ts's subscriptionsJson) cover
// this publish at all. "*" subscribes to every type (used by a Chamber
// whose own logic doesn't filter by type, e.g. Deputy). A Chamber's own
// precise per-rule matching (exact minPriority, condition fields, ...)
// still happens after it receives the delivery - this is only ever a
// superset filter, never the final word on whether something "matches".
export function subscriptionMatches(
  subscriptions: ChamberSubscription[],
  type: string,
  priority: PriorityLevel
): boolean {
  // An absent minPriority means "low" here specifically - i.e. relay
  // everything of that type - rather than eventMatching's own "treat an
  // unset level as normal" default, which is about a *publisher* that
  // didn't declare a priority, not a subscriber that didn't set a floor.
  return subscriptions.some((s) => (s.type === "*" || s.type === type) && priorityAtLeast(priority, s.minPriority ?? "low"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deliverToChamber(chamberName: string, body: unknown): Promise<void> {
  for (const delay of RETRY_DELAYS_MS) {
    if (delay > 0) await sleep(delay);
    // Re-read the registry on every attempt (not just after a delay) - a
    // chamber's apiBase could change on re-registration, and skipping an
    // attempt against one the heartbeat sweep has since marked non-active
    // avoids burning the full timeout on a call already known to fail (see
    // registry.ts's sweepStaleChambers).
    const current = getChamber(chamberName);
    if (!current || current.status !== "active") continue;
    try {
      const res = await fetch(`${current.apiBase}/events/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Congress-Internal-Token": env.CONGRESS_INTERNAL_TOKEN },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });
      if (res.ok) return;
      console.warn(`Event delivery to ${chamberName} rejected: ${res.status}`);
    } catch (err) {
      console.warn(`Event delivery to ${chamberName} failed: ${(err as Error).message}`);
    }
  }
  console.warn(`Event delivery to ${chamberName} gave up after ${RETRY_DELAYS_MS.length} attempts`);
}

// Push-relays a published domain event to every currently-active,
// currently-subscribed Chamber instead of storing it - Congress never
// inspects `type`/`payload` beyond the priority convention below, and keeps
// no record of what it relayed. Fire-and-forget from the publisher's own
// perspective (see POST /congress/events/publish in server.ts, which
// doesn't await this): each interested Chamber's own delivery retries
// independently in the background.
export function publishEvent(req: EventPublishRequest): void {
  const priority = priorityOf(req.payload);
  const occurredAt = req.occurredAt ?? new Date().toISOString();
  const body = { chamber: req.chamber, type: req.type, payload: req.payload, occurredAt };

  const targets = listChambers().filter(
    (c) => c.status === "active" && subscriptionMatches(c.subscriptions, req.type, priority)
  );
  for (const chamber of targets) {
    void deliverToChamber(chamber.name, body);
  }
}
