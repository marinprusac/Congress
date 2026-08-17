import { z } from "zod";

export const canvasScopeSchema = z.enum(["mobile", "desktop"]);
export type CanvasScope = z.infer<typeof canvasScopeSchema>;

export const widgetPlacementSchema = z.object({
  chamber: z.string(),
  widgetId: z.string(),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
});
export type WidgetPlacement = z.infer<typeof widgetPlacementSchema>;

export const upsertPlacementRequestSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
});
export type UpsertPlacementRequest = z.infer<typeof upsertPlacementRequestSchema>;
