import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { eventDeliverySchema, type EventDelivery } from "@congress/shared-types";

type ChamberApp = Hono<{ Bindings: HttpBindings }>;

// Mounts the fixed-convention POST /api/events/receive route every Chamber
// gets for free - the push counterpart to createPublishEvent, and generic
// the same way createMcpApp is: available to any Chamber, not hardcoded to
// the few that use it today (Logs/Automation/Deputy). Congress calls this
// directly (see services/congress/src/events.ts's fan-out) instead of a
// Chamber polling GET /congress/events?since=. Gated by the same
// shared-secret header used for register/heartbeat/mcp
// (X-Congress-Internal-Token) - Congress is the only caller.
//
// `onEvent` runs fire-and-forget from this route's own perspective: the
// response is sent as soon as it's kicked off, not once it finishes. This
// matters for Congress's own retry behavior (events.ts) - if this route
// instead awaited a slow handler (e.g. Automation Chamber's MCP tool call)
// before responding, a delivery that's merely slow (not actually failed)
// could hit Congress's own fetch timeout and get retried, running the same
// handler twice for one publish.
export function mountEventReceiveRoute(
  app: ChamberApp,
  internalToken: string,
  onEvent: (event: EventDelivery) => void | Promise<void>
): void {
  app.post("/api/events/receive", async (c) => {
    const token = c.req.header("X-Congress-Internal-Token");
    if (!token || token !== internalToken) return c.json({ error: "unauthorized" }, 401);

    const body = await c.req.json().catch(() => null);
    const parsed = eventDeliverySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
    }

    void Promise.resolve(onEvent(parsed.data)).catch((err) => {
      console.warn(`Event handler failed for ${parsed.data.type}: ${(err as Error).message}`);
    });

    return c.json({ ok: true });
  });
}
