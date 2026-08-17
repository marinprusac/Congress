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
});
export type Manifest = z.infer<typeof manifestSchema>;

export const chamberRegistryEntrySchema = manifestSchema.extend({
  status: chamberStatusSchema,
  registeredAt: z.string(),
  lastHeartbeatAt: z.string().nullable(),
});
export type ChamberRegistryEntry = z.infer<typeof chamberRegistryEntrySchema>;
