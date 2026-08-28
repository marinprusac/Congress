import { z } from "zod";
import { priorityLevelSchema } from "@congress/shared-types";

export const taskSummarySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string(),
  dueDate: z.string().nullable(),
  completed: z.boolean(),
  priority: priorityLevelSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TaskSummary = z.infer<typeof taskSummarySchema>;

export const taskDetailSchema = taskSummarySchema;
export type TaskDetail = z.infer<typeof taskDetailSchema>;

export const createTaskRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  dueDate: z.string().nullable().optional(),
  priority: priorityLevelSchema.default("normal"),
});
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

export const updateTaskRequestSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  dueDate: z.string().nullable().optional(),
  completed: z.boolean().optional(),
  priority: priorityLevelSchema.optional(),
});
export type UpdateTaskRequest = z.infer<typeof updateTaskRequestSchema>;

// No settings of its own today - the due/overdue checkup (notifications.ts)
// is now a precise next-wake timer rather than a polled interval, so
// there's no "how often to check" knob left to expose. Kept for contract
// uniformity with every other Chamber's own settings surface.
export const tasksSettingsSchema = z.object({});
export type TasksSettings = z.infer<typeof tasksSettingsSchema>;

export const updateTasksSettingsRequestSchema = z.object({});
export type UpdateTasksSettingsRequest = z.infer<typeof updateTasksSettingsRequestSchema>;
