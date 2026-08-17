import { z } from "zod";

export const chamberStatusSchema = z.enum(["active", "offline"]);
export type ChamberStatus = z.infer<typeof chamberStatusSchema>;

export const manifestRoutesSchema = z.object({
  home: z.string(),
  settings: z.string(),
  widget: z.string(),
});
export type ManifestRoutes = z.infer<typeof manifestRoutesSchema>;

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
});
export type Manifest = z.infer<typeof manifestSchema>;

export const chamberRegistryEntrySchema = manifestSchema.extend({
  status: chamberStatusSchema,
  registeredAt: z.string(),
  lastHeartbeatAt: z.string().nullable(),
});
export type ChamberRegistryEntry = z.infer<typeof chamberRegistryEntrySchema>;
