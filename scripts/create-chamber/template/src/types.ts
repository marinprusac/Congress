import { z } from "zod";

export const itemSummarySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  body: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ItemSummary = z.infer<typeof itemSummarySchema>;

export const itemDetailSchema = itemSummarySchema;
export type ItemDetail = z.infer<typeof itemDetailSchema>;

export const createItemRequestSchema = z.object({
  name: z.string().min(1),
  body: z.string().default(""),
});
export type CreateItemRequest = z.infer<typeof createItemRequestSchema>;

export const updateItemRequestSchema = z.object({
  name: z.string().min(1).optional(),
  body: z.string().optional(),
});
export type UpdateItemRequest = z.infer<typeof updateItemRequestSchema>;

export const settingsSchema = z.object({});
export type Settings = z.infer<typeof settingsSchema>;

export const updateSettingsRequestSchema = z.object({});
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;
