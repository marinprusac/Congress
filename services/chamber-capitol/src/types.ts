import { z } from "zod";

// Capitol's own local settings - just which Chamber widgets are hidden from
// the homepage grid. Dark mode is Congress-owned (see @congress/shared-types'
// CapitolSettings) since it has to hold even when Capitol isn't registered.
export const settingsSchema = z.object({
  hiddenWidgets: z.array(z.string()),
});
export type Settings = z.infer<typeof settingsSchema>;

export const updateSettingsRequestSchema = z.object({
  hiddenWidgets: z.array(z.string()).optional(),
});
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;
