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
});
export type Manifest = z.infer<typeof manifestSchema>;

export const registerRequestSchema = manifestSchema;
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const deregisterRequestSchema = z.object({
  name: z.string().min(1),
});
export type DeregisterRequest = z.infer<typeof deregisterRequestSchema>;

export const heartbeatRequestSchema = z.object({
  name: z.string().min(1),
});
export type HeartbeatRequest = z.infer<typeof heartbeatRequestSchema>;

export const chamberRegistryEntrySchema = manifestSchema.extend({
  status: chamberStatusSchema,
  registeredAt: z.string(),
  lastHeartbeatAt: z.string().nullable(),
});
export type ChamberRegistryEntry = z.infer<typeof chamberRegistryEntrySchema>;
