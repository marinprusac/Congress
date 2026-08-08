import { z } from "zod";

// The common shape every Chamber's widget endpoint (GET {apiBase}/widget) returns.
// Capitol renders this generically - it never needs to know a Chamber's domain shape.
export const chamberWidgetSchema = z.object({
  summary: z.string(),
  items: z.array(z.object({ label: z.string() })).default([]),
});
export type ChamberWidget = z.infer<typeof chamberWidgetSchema>;
