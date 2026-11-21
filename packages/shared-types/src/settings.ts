import { z } from "zod";

// Congress-wide preferences owned by Congress itself (not any one Chamber) -
// dark mode needs to hold consistently across every frontend, whether or not
// any Chamber is registered. Chamber-local preferences use each Chamber's
// normal per-Chamber settings contract instead of this one.

export const capitolSettingsSchema = z.object({
  darkMode: z.boolean(),
});
export type CapitolSettings = z.infer<typeof capitolSettingsSchema>;

export const updateCapitolSettingsRequestSchema = z.object({
  darkMode: z.boolean().optional(),
});
export type UpdateCapitolSettingsRequest = z.infer<typeof updateCapitolSettingsRequestSchema>;
