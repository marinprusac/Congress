import { z } from "zod";
import { chamberSubscriptionSchema } from "./events.js";

// "detached" is a manual owner override (see congress/src/registry.ts's
// detachChamber/attachChamber) - distinct from "offline" so an incoming
// heartbeat from a Chamber that's still actually running doesn't silently
// undo it. Everywhere in the frontend that gates on `status === "active"`
// already treats "detached" the same as "offline" for free.
export const chamberStatusSchema = z.enum(["active", "offline", "detached"]);
export type ChamberStatus = z.infer<typeof chamberStatusSchema>;

export const manifestRoutesSchema = z.object({
  home: z.string(),
  settings: z.string(),
});
export type ManifestRoutes = z.infer<typeof manifestRoutesSchema>;

// One entry per homepage widget a Chamber contributes to Capitol's cell-based
// canvas. `id` is a stable identifier - the key into that Chamber's
// remote-entry `widgets` export (see ChamberHost/remoteModule.ts) and part
// of its canvas placement key - never shown to the user, unlike `label`.
// `width`/`height` are the widget's fixed footprint in canvas cells,
// declared by the Chamber and not user-resizable. No route: a widget isn't
// a navigable URL, it's a component resolved out of the Chamber's own
// already-built remote-entry.js.
export const manifestWidgetSchema = z.object({
  id: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  label: z.string().min(1),
});
export type ManifestWidget = z.infer<typeof manifestWidgetSchema>;

// Describes one field of a declared event's payload - deliberately the same
// shape as an MCP tool's own JSON-Schema `properties` entries (see
// chamber-automation's ArgsEditor.tsx), so both sides of a
// trigger-event-payload -> tool-argument template share one mental model.
// Flat only, same restraint ArgsEditor already commits to for tool args: no
// nested objects, and `items` describes an array field's elements one level
// deep, not recursively.
export const manifestEventFieldSchema = z.object({
  type: z.enum(["string", "number", "boolean", "array"]).optional(),
  description: z.string().optional(),
  items: z
    .object({
      type: z.enum(["string", "number", "boolean"]).optional(),
      description: z.string().optional(),
    })
    .optional(),
});
export type ManifestEventField = z.infer<typeof manifestEventFieldSchema>;

// One entry per domain event a Chamber may publish (POST
// /congress/events/publish) - purely a declared catalog for other Chambers'
// own UI (e.g. an automation editor's event-type picker) to read off the
// live registry; Congress itself never inspects this field beyond storing
// and returning it; see events.ts for the actual publish/push-relay
// contract. `type` is conventionally "<chamber>.<event>" (e.g.
// "tasks.due_soon") so it's self-namespacing without a separate chamber
// filter downstream. `payloadFields` is likewise purely descriptive - it
// documents the shape of the object literal passed to `publishEvent` at each
// of that event's actual call sites, kept in sync by hand rather than
// derived, so a template-editing UI (notify title/body/link, an automation's
// arg template) can offer known payload paths instead of requiring the owner
// to already know the shape from reading source.
export const manifestEventSchema = z.object({
  type: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  payloadFields: z.record(z.string(), manifestEventFieldSchema).optional(),
});
export type ManifestEvent = z.infer<typeof manifestEventSchema>;

// Congress is the one publisher with no manifest of its own to declare these
// in - it's the registry owner, not a registrant (see CLAUDE.md), so it never
// appears in the live registry chamber-logs' eventCatalogSync.ts iterates to
// auto-derive event_settings rows. This is that catalog entry, hand-written
// here instead, so Congress's own chamber-health events are still
// configurable (notify/record toggles) from the Logs UI like any other
// Chamber's declared events - see eventCatalogSync.ts's synthetic-chamber
// merge and registry.ts's actual publish sites.
export const CONGRESS_SYNTHETIC_EVENTS: ManifestEvent[] = [
  {
    type: "congress.chamber_offline",
    label: "Chamber went offline",
    description: "A registered Chamber missed its heartbeat threshold and was marked offline.",
    payloadFields: { chamberName: { type: "string" } },
  },
  {
    type: "congress.chamber_online",
    label: "Chamber came back online",
    description: "A previously-offline Chamber registered or heartbeated again.",
    payloadFields: { chamberName: { type: "string" } },
  },
];

export const manifestSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().min(1),
  version: z.string().min(1),
  routes: manifestRoutesSchema,
  apiBase: z.string().url(),
  mcpUrl: z.string().url().optional(),
  healthUrl: z.string().url(),
  // Homepage widgets this Chamber contributes to Capitol's canvas. Defaulted
  // so a Chamber registering against an old manifest shape (or a chamber with
  // no widgets, like Capitol itself) never has to think about this field.
  widgets: z.array(manifestWidgetSchema).default([]),
  // Domain events this Chamber may publish. Defaulted the same way as
  // widgets - most Chambers publish none.
  events: z.array(manifestEventSchema).default([]),
});
export type Manifest = z.infer<typeof manifestSchema>;

export const chamberRegistryEntrySchema = manifestSchema.extend({
  status: chamberStatusSchema,
  registeredAt: z.string(),
  lastHeartbeatAt: z.string().nullable(),
  // This Chamber's current dynamic event interest list, kept fresh on every
  // heartbeat (see events.ts's chamberSubscriptionSchema) - not part of the
  // static manifest above, since it changes at runtime as the Chamber's own
  // rules/automations are edited, independent of a redeploy.
  subscriptions: z.array(chamberSubscriptionSchema).default([]),
});
export type ChamberRegistryEntry = z.infer<typeof chamberRegistryEntrySchema>;
