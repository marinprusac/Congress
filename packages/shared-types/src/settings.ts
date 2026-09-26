import { z } from "zod";

// Congress-wide preferences owned by Congress itself (not any one Chamber) -
// dark mode needs to hold consistently across every frontend, whether or not
// any Chamber is registered. Chamber-local preferences use each Chamber's
// normal per-Chamber settings contract instead of this one.

// One view pinned to the home screen's "stories" row - the owner's fixed,
// always-there shortcuts, alongside the ranked feed below them.
export const pinnedViewSchema = z.object({
  chamber: z.string().min(1),
  viewId: z.string().min(1),
});
export type PinnedView = z.infer<typeof pinnedViewSchema>;

export const capitolSettingsSchema = z.object({
  darkMode: z.boolean(),
  pinnedViews: z.array(pinnedViewSchema),
});
export type CapitolSettings = z.infer<typeof capitolSettingsSchema>;

export const updateCapitolSettingsRequestSchema = z.object({
  darkMode: z.boolean().optional(),
  pinnedViews: z.array(pinnedViewSchema).max(12).optional(),
});
export type UpdateCapitolSettingsRequest = z.infer<typeof updateCapitolSettingsRequestSchema>;
