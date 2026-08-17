import type { EventPublishRequest } from "@congress/shared-types";

// Publishes a domain event to Congress's generic event log
// (POST /congress/events/publish) - same "best-effort, never blocks the
// caller" shape as createPushExhibitSync. The publishing Chamber doesn't
// know or care whether anything is listening;
// Congress just appends the row. See packages/shared-types/src/events.ts
// for the request shape and manifestEventSchema (shared-types/manifest.ts)
// for how a Chamber declares its own catalog of event types it may publish.
export function createPublishEvent(opts: { chamber: string; capitolUrl: string; internalToken: string }) {
  return async function publishEvent(event: Omit<EventPublishRequest, "chamber">): Promise<void> {
    try {
      const res = await fetch(`${opts.capitolUrl}/congress/events/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Congress-Internal-Token": opts.internalToken,
        },
        body: JSON.stringify({ chamber: opts.chamber, ...event }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        console.warn(`Event publish rejected by Congress: ${res.status}`);
      }
    } catch (err) {
      console.warn(`Event publish failed: ${(err as Error).message}`);
    }
  };
}
