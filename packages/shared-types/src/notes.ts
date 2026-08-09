import { z } from "zod";

export const noteFrontmatterSchema = z.record(z.string(), z.unknown());
export type NoteFrontmatter = z.infer<typeof noteFrontmatterSchema>;

export const noteSummarySchema = z.object({
  id: z.number().int(),
  title: z.string(),
  frontmatter: noteFrontmatterSchema,
  excerpt: z.string(),
  pinned: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type NoteSummary = z.infer<typeof noteSummarySchema>;

export const noteDetailSchema = noteSummarySchema.extend({
  // Full raw markdown, including the frontmatter fence if present - what an editor should load.
  content: z.string(),
});
export type NoteDetail = z.infer<typeof noteDetailSchema>;

export const createNoteRequestSchema = z.object({
  title: z.string().min(1),
  content: z.string().default(""),
});
export type CreateNoteRequest = z.infer<typeof createNoteRequestSchema>;

export const updateNoteRequestSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().optional(),
  pinned: z.boolean().optional(),
});
export type UpdateNoteRequest = z.infer<typeof updateNoteRequestSchema>;
