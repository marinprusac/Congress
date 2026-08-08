import { z } from "zod";

export const noteFrontmatterSchema = z.record(z.string(), z.unknown());
export type NoteFrontmatter = z.infer<typeof noteFrontmatterSchema>;

export const noteSummarySchema = z.object({
  id: z.number().int(),
  title: z.string(),
  frontmatter: noteFrontmatterSchema,
  excerpt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type NoteSummary = z.infer<typeof noteSummarySchema>;

export const wikiLinkSchema = z.object({
  target: z.string(),
  alias: z.string().nullable(),
  resolved: z.boolean(),
});
export type WikiLink = z.infer<typeof wikiLinkSchema>;

export const backlinkSchema = z.object({
  id: z.number().int(),
  title: z.string(),
});
export type Backlink = z.infer<typeof backlinkSchema>;

export const noteDetailSchema = noteSummarySchema.extend({
  // Full raw markdown, including the frontmatter fence if present - what an editor should load.
  content: z.string(),
  outgoingLinks: z.array(wikiLinkSchema),
  backlinks: z.array(backlinkSchema),
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
});
export type UpdateNoteRequest = z.infer<typeof updateNoteRequestSchema>;
