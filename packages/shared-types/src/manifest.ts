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

// One entry per domain event a Chamber may publish (POST
// /congress/events/publish) - purely a declared catalog for other Chambers'
// own UI (e.g. an automation editor's event-type picker) to read off the
// live registry; Congress itself never inspects this field beyond storing
// and returning it; see events.ts for the actual publish/push-relay
// contract. `type` is conventionally "<chamber>.<event>" (e.g.
// "tasks.due_soon") so it's self-namespacing without a separate chamber
// filter downstream.
export const manifestEventSchema = z.object({
  type: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
});
export type ManifestEvent = z.infer<typeof manifestEventSchema>;

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
