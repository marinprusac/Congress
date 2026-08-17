import { z } from "zod";

// Published by a Chamber that wants something to happen when a condition
// only it can detect becomes true - "task is due soon", "event starting in
// 5 min" - without knowing or caring whether anything is listening.
// Congress only ever appends these to its own log (POST
// /congress/events/publish); it never inspects `type`, relays to a chamber
// by name, or otherwise acts on the event itself - any Chamber (today, only
// the notifications Chamber) pulls new ones on its own schedule via GET
// /congress/events?since=<cursor>. `type` is conventionally
// "<chamber>.<event>" (e.g. "tasks.due_soon") so it's self-namespacing
// without a separate chamber filter downstream - see manifestEventSchema
// (manifest.ts) for how a Chamber declares its own catalog of these.
// A convention, not an enforced part of the request shape below - a
// publishing Chamber may set `payload.priority` to one of these to signal
// how much attention an instance of an event deserves (a task due in 5
// minutes vs. one due tomorrow, say), ordered low to urgent. Congress itself
// never reads this - it's Logs Chamber that extracts it (defaulting to
// "normal" when a Chamber didn't set one) to drive its own rules'
// `minPriority` threshold and its priority-filtered widget. Kept here rather
// than chamber-local so any publishing Chamber and Logs Chamber agree on the
// same vocabulary/ordering without importing from each other.
export const PRIORITY_LEVELS = ["low", "normal", "high", "urgent"] as const;
export const priorityLevelSchema = z.enum(PRIORITY_LEVELS);
export type PriorityLevel = z.infer<typeof priorityLevelSchema>;

export const eventPublishRequestSchema = z.object({
  chamber: z.string().min(1),
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
  occurredAt: z.string().optional(),
});
export type EventPublishRequest = z.infer<typeof eventPublishRequestSchema>;

export const eventLogEntrySchema = z.object({
  id: z.number().int(),
  chamber: z.string(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  occurredAt: z.string(),
});
export type EventLogEntry = z.infer<typeof eventLogEntrySchema>;

export const eventLogResponseSchema = z.object({
  events: z.array(eventLogEntrySchema),
  // The id to pass as the next poll's `?since=` - the id of the last event
  // in this batch, or the caller's own `since` echoed back when the batch
  // was empty (nothing to advance past yet).
  cursor: z.number().int(),
});
export type EventLogResponse = z.infer<typeof eventLogResponseSchema>;
