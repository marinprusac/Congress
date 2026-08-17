import { z } from "zod";

export const chamberStatusSchema = z.enum(["active", "offline"]);
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
// and returning it; see events.ts for the actual publish/log contract.
// `type` is conventionally "<chamber>.<event>" (e.g. "tasks.due_soon") so
// it's self-namespacing without a separate chamber filter downstream.
export const manifestEventSchema = z.object({
  type: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  // How long Congress keeps a published instance of this event type in its
  // own log before pruning it - Congress copies this number verbatim onto
  // each published row (see services/congress/src/events.ts) without
  // interpreting it, same as it never interprets `payload`. Defaults to a
  // short window (see that file's DEFAULT_RETENTION_MS) when unset - the
  // event log is a switch for chambers that poll on their own short
  // interval, not a durable record (that's Logs Chamber's job).
  retentionMs: z.number().int().positive().optional(),
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
  // Declares how this Chamber's Exhibit bodies should be rendered by
  // Capitol's public Exhibit Sharing viewer (services/congress/frontend/src/
  // pages/SharedViewPage.tsx). Defaults to plain annotated text; set to
  // "markdown" if bodies use [[wikilink]]/Markdown syntax (e.g. Notes).
  contentFormat: z.enum(["markdown", "plain"]).optional(),
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
});
export type ChamberRegistryEntry = z.infer<typeof chamberRegistryEntrySchema>;
