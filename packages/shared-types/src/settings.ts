import { z } from "zod";

// Congress-wide preferences owned by Congress itself (not any one Chamber) -
// dark mode needs to hold consistently across every frontend, including
// when Capitol (the Chamber that owns the toggle UI for this) isn't even
// registered. Chamber-local preferences - e.g. Capitol's own "hidden
// widgets" list - use each Chamber's normal per-Chamber settings contract
// instead of this one.
export const capitolSettingsSchema = z.object({
  darkMode: z.boolean(),
});
export type CapitolSettings = z.infer<typeof capitolSettingsSchema>;

export const updateCapitolSettingsRequestSchema = z.object({
  darkMode: z.boolean().optional(),
});
export type UpdateCapitolSettingsRequest = z.infer<typeof updateCapitolSettingsRequestSchema>;
