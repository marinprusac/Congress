import { z } from "zod";

export const documentSummarySchema = z.object({
  id: z.number().int(),
  title: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DocumentSummary = z.infer<typeof documentSummarySchema>;

export const documentDetailSchema = documentSummarySchema.extend({
  description: z.string(),
});
export type DocumentDetail = z.infer<typeof documentDetailSchema>;

// File bytes travel as multipart form data, not JSON - this only covers the
// metadata fields validated server-side once the upload has been parsed.
export const updateDocumentRequestSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
});
export type UpdateDocumentRequest = z.infer<typeof updateDocumentRequestSchema>;
