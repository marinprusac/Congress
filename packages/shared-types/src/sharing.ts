import { z } from "zod";

export const sharePermissionSchema = z.enum(["view", "edit"]);
export type SharePermission = z.infer<typeof sharePermissionSchema>;

// Owner-facing summary of a share, returned by GET /congress/shares and
// GET /congress/exhibits/:id/shares. `direct` only carries meaning in the
// latter (exhibit-scoped) response - it's omitted (equivalent to true) for
// endpoints not scoped to a particular exhibit. false means the share's
// root is some other exhibit and this one is merely reached through its
// closure - the share still belongs to whoever owns the root, but is
// editable/revocable the same way since sharing is entirely token-scoped.
export const shareSummarySchema = z.object({
  token: z.string(),
  rootId: z.string(),
  rootChamber: z.string(),
  maxDepth: z.number().int(),
  permission: sharePermissionSchema,
  label: z.string(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  lastAccessedAt: z.string().nullable(),
  direct: z.boolean().optional(),
});
export type ShareSummary = z.infer<typeof shareSummarySchema>;

// PATCH /congress/shares/:token - same token, updated terms. expiresAt:
// undefined = leave unchanged, null = clear it, string = set it.
export const updateShareRequestSchema = z.object({
  permission: sharePermissionSchema.optional(),
  maxDepth: z.number().int().min(0).optional(),
  label: z.string().optional(),
  expiresAt: z.string().nullable().optional(),
});
export type UpdateShareRequest = z.infer<typeof updateShareRequestSchema>;

// Canonical content envelope every Chamber maps its own detail shape into,
// for GET /exhibits/:id/content. Keeps the shared viewer + Capitol's proxy
// chamber-agnostic - no chamber-specific rendering knowledge required.
export const sharedExhibitContentSchema = z.object({
  id: z.string(),
  chamber: z.string(),
  type: z.string(),
  name: z.string(),
  body: z.string(),
  isBinary: z.boolean(),
  downloadUrl: z.string().optional(),
});
export type SharedExhibitContent = z.infer<typeof sharedExhibitContentSchema>;

// PATCH /exhibits/:id/content - chamber-defined field set, title is the only
// universally-applicable field so it's the only one enforced here.
export const updateSharedExhibitContentRequestSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().optional(),
});
export type UpdateSharedExhibitContentRequest = z.infer<typeof updateSharedExhibitContentRequestSchema>;

// GET /congress/exhibits/:id/sharing - owner-facing, drives the "Shared" /
// "Shared (inherited)" badge on a chamber's own view pages.
export const exhibitSharingEntrySchema = z.object({
  token: z.string(),
  label: z.string(),
  permission: sharePermissionSchema,
  direct: z.boolean(),
});
export type ExhibitSharingEntry = z.infer<typeof exhibitSharingEntrySchema>;

