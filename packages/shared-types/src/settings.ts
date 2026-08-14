import { z } from "zod";

// Congress-wide preferences owned by Capitol (not any one Chamber) - dark
// mode is the first of these, since it needs to hold consistently across
// every frontend the same way Notes' autosave setting holds across devices.
// hiddenWidgets holds Chamber names hidden from the homepage widget grid.
export const capitolSettingsSchema = z.object({
  darkMode: z.boolean(),
  hiddenWidgets: z.array(z.string()),
});
export type CapitolSettings = z.infer<typeof capitolSettingsSchema>;

export const updateCapitolSettingsRequestSchema = z.object({
  darkMode: z.boolean().optional(),
  hiddenWidgets: z.array(z.string()).optional(),
});
export type UpdateCapitolSettingsRequest = z.infer<typeof updateCapitolSettingsRequestSchema>;
