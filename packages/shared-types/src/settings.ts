import { z } from "zod";

// Congress-wide preferences owned by Congress itself (not any one Chamber) -
// dark mode needs to hold consistently across every frontend the same way
// Notes' autosave setting holds across devices, including when Capitol (the
// Chamber that owns the toggle UI for this) isn't even registered. Chamber-
// local preferences - e.g. Capitol's own "hidden widgets" list - use each
// Chamber's normal per-Chamber settings contract instead of this one.
export const capitolSettingsSchema = z.object({
  darkMode: z.boolean(),
  // How long Congress's generic event log (events.ts) keeps a published
  // event before pruning it, when the publishing Chamber's own manifest
  // didn't declare a more specific retentionMs for that event type - see
  // events.ts's publishEvent. Owner-tunable here instead of a hardcoded
  // constant so a Chamber whose poll interval grows doesn't need a
  // code change/redeploy to keep events alive long enough to be seen.
  eventRetentionMs: z.number().int().positive(),
});
export type CapitolSettings = z.infer<typeof capitolSettingsSchema>;

export const updateCapitolSettingsRequestSchema = z.object({
  darkMode: z.boolean().optional(),
  eventRetentionMs: z.number().int().positive().optional(),
});
export type UpdateCapitolSettingsRequest = z.infer<typeof updateCapitolSettingsRequestSchema>;
