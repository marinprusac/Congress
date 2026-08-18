import { z } from "zod";

export const taskSummarySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string(),
  dueDate: z.string().nullable(),
  completed: z.boolean(),
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
});
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

export const updateTaskRequestSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  dueDate: z.string().nullable().optional(),
  completed: z.boolean().optional(),
});
export type UpdateTaskRequest = z.infer<typeof updateTaskRequestSchema>;

export const tasksSettingsSchema = z.object({
  // How often the due/overdue checkup (notifications.ts) re-scans open
  // tasks and publishes tasks.due_soon/tasks.overdue/tasks.due_cleared
  // events. Owner-tunable instead of a hardcoded constant, same reasoning
  // as chamber-deputy's checkupIntervalMs.
  checkIntervalMs: z.number().int().positive(),
});
export type TasksSettings = z.infer<typeof tasksSettingsSchema>;

export const updateTasksSettingsRequestSchema = z.object({
  checkIntervalMs: z.number().int().positive().optional(),
});
export type UpdateTasksSettingsRequest = z.infer<typeof updateTasksSettingsRequestSchema>;
