import { z } from "zod";

// Who performed an action: "me" (the owner, via the UI), "deputy" (Deputy
// Chamber's agent, via MCP), "automation" (Automation Chamber), or "system"
// (timers/pollers/devices - no human or agent in the loop). A plain
// namespaced string rather than an enum so future collaborators can be
// "user:<name>" without a schema change. Carried on the ACTOR_HEADER between
// services (set by Congress's gateway for the owner's session and by
// Deputy/Automation for their own MCP calls, never trusted from a browser),
// and stamped onto every event a Chamber publishes while handling such a call.
export const ACTOR_HEADER = "X-Congress-Actor";
export const DEFAULT_ACTOR = "system";
export const actorSchema = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9:_.-]*$/i);
export type Actor = z.infer<typeof actorSchema>;

// Published by a Chamber that wants something to happen when a condition
// only it can detect becomes true - "task is due soon", "event starting in
// 5 min" - without knowing or caring whether anything is listening.
// Congress never stores these or inspects `type`/`payload` itself - it
// immediately push-relays a publish (POST /congress/events/publish) to
// every currently-active Chamber whose own declared subscriptions
// (chamberSubscriptionSchema below) match, POSTing to that Chamber's own
// fixed-convention POST /api/events/receive. `type` is conventionally
// "<chamber>.<event>" (e.g. "tasks.due_soon") so it's self-namespacing
// without a separate chamber filter downstream - see manifestEventSchema
// (manifest.ts) for how a Chamber declares its own catalog of these.
export const eventPublishRequestSchema = z.object({
  chamber: z.string().min(1),
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
  occurredAt: z.string().optional(),
  actor: actorSchema.optional(),
});
export type EventPublishRequest = z.infer<typeof eventPublishRequestSchema>;

// What a subscribing Chamber's own POST /api/events/receive is handed - one
// per matched publish, delivered directly rather than read off a stored
// log, so there's no `id`/cursor here the way there used to be. A Chamber
// that needs to keep its own record of what it's received (e.g. Deputy
// Chamber buffering toward its next periodic checkup) does so in its own
// storage, keyed however it likes - this shape is just the wire delivery.
export const eventDeliverySchema = z.object({
  chamber: z.string(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  occurredAt: z.string(),
  // Absent on a delivery from a Congress older than this field.
  actor: actorSchema.optional(),
});
export type EventDelivery = z.infer<typeof eventDeliverySchema>;

// A locally-numbered event, for a Chamber that keeps its own short-lived
// buffer of received deliveries (see chamber-deputy's pending_checkup_events)
// and wants a stable id to dedupe/order by within that buffer - `id` here is
// only ever meaningful to whoever assigned it, never a Congress-wide id.
export const eventLogEntrySchema = z.object({
  id: z.number().int(),
  chamber: z.string(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  occurredAt: z.string(),
  actor: actorSchema.optional(),
});
export type EventLogEntry = z.infer<typeof eventLogEntrySchema>;

// One entry in a Chamber's own dynamic, owner-editable interest list -
// carried on every heartbeat (not the static manifest, since what a Chamber
// cares about changes at runtime as its own rules/automations/directives
// are edited) so Congress knows who to push a given publish to without
// broadcasting to every registered Chamber regardless of interest. `type`
// of "*" means "every event type" (used by a Chamber whose own logic
// doesn't filter by type at all, e.g. Deputy). Congress's own filter is a
// coarse "could this possibly interest this Chamber" gate; the Chamber
// still does its own precise per-rule matching after receiving (see
// docs/creating-a-chamber.md's Events section).
export const chamberSubscriptionSchema = z.object({
  type: z.string().min(1),
});
export type ChamberSubscription = z.infer<typeof chamberSubscriptionSchema>;
