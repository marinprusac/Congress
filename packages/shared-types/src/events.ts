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

// A domain event published in-process (by a record type, a connector or the AI)
// when a condition worth announcing becomes true - "task is due soon", "mail
// received" - without knowing whether anything is listening. `type` is
// conventionally "<source>.<event>" (e.g. "task.due_soon"); manifestEventSchema
// (manifest.ts) is how a source declares its catalog of these.
export const eventPublishRequestSchema = z.object({
  chamber: z.string().min(1),
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
  occurredAt: z.string().optional(),
  actor: actorSchema.optional(),
});
export type EventPublishRequest = z.infer<typeof eventPublishRequestSchema>;

// A published event as Congress's log rules and the AI's observers receive it
// (occurredAt always stamped).
export const eventDeliverySchema = z.object({
  chamber: z.string(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  occurredAt: z.string(),
  actor: actorSchema.optional(),
});
export type EventDelivery = z.infer<typeof eventDeliverySchema>;
