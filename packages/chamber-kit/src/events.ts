import type { EventPublishRequest } from "@congress/shared-types";
import { currentActor } from "./actorContext.js";
import { getCongressHost } from "./host.js";

// Publishes a domain event to Congress's event relay. Best-effort and never
// blocks the caller: the publishing Chamber doesn't know whether anything is
// listening. See shared-types' manifestEventSchema for the catalog.
export function createPublishEvent(opts: { chamber: string }) {
  return async function publishEvent(event: Omit<EventPublishRequest, "chamber">): Promise<void> {
    const host = getCongressHost();
    if (!host) return;
    try {
      // Explicit actor wins; otherwise whoever's request we're handling
      // (or "system" from a timer/poller with no request context).
      host.publishEvent({ chamber: opts.chamber, ...event, actor: event.actor ?? currentActor() });
    } catch (err) {
      console.warn(`[${opts.chamber}] event publish failed: ${(err as Error).message}`);
    }
  };
}
