import { z } from "zod";

export const mailCategorySchema = z.enum(["primary", "promotions", "social", "updates", "forums"]);

export const mailAccountSchema = z.object({
  id: z.number().int(),
  label: z.string(),
  email: z.string(),
  needsReconnect: z.boolean(),
  // Whether this account has granted Gmail read access.
  hasAccess: z.boolean(),
  // Whether Mail may mark threads read in Gmail (gmail.modify granted).
  canMarkRead: z.boolean(),
  lastSyncedAt: z.string().nullable(),
  lastError: z.string().nullable(),
});
export type MailAccount = z.infer<typeof mailAccountSchema>;

const addressSchema = z.object({ name: z.string().nullable(), email: z.string().nullable() });
export type Address = z.infer<typeof addressSchema>;

// One message, from the local cache (headers + snippet only).
export const messageSummarySchema = z.object({
  accountId: z.number().int(),
  messageId: z.string(),
  threadId: z.string(),
  exhibitId: z.string(),
  from: addressSchema,
  to: z.string().nullable(),
  subject: z.string(),
  snippet: z.string(),
  date: z.string(),
  unread: z.boolean(),
  inInbox: z.boolean(),
  category: mailCategorySchema,
  labelIds: z.array(z.string()),
  hasAttachments: z.boolean(),
  url: z.string(),
});
export type MessageSummary = z.infer<typeof messageSummarySchema>;

export const threadSummarySchema = z.object({
  accountId: z.number().int(),
  accountEmail: z.string(),
  threadId: z.string(),
  exhibitId: z.string(),
  subject: z.string(),
  // Sender of the latest message.
  from: addressSchema,
  participants: z.array(z.string()),
  date: z.string(),
  snippet: z.string(),
  messageCount: z.number().int(),
  unread: z.boolean(),
  labelIds: z.array(z.string()),
  url: z.string(),
});
export type ThreadSummary = z.infer<typeof threadSummarySchema>;

export const attachmentSchema = z.object({
  partId: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  size: z.number(),
  attachmentId: z.string().nullable(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const messageDetailSchema = z.object({
  accountId: z.number().int(),
  messageId: z.string(),
  threadId: z.string(),
  from: addressSchema,
  to: z.string().nullable(),
  cc: z.string().nullable(),
  replyTo: z.string().nullable(),
  date: z.string(),
  subject: z.string(),
  labelIds: z.array(z.string()),
  unread: z.boolean(),
  // Plain text (from text/plain, or converted from HTML).
  text: z.string(),
  html: z.string().nullable(),
  attachments: z.array(attachmentSchema),
});
export type MessageDetail = z.infer<typeof messageDetailSchema>;

export const threadDetailSchema = z.object({
  accountId: z.number().int(),
  accountEmail: z.string(),
  threadId: z.string(),
  exhibitId: z.string(),
  subject: z.string(),
  labelIds: z.array(z.string()),
  gmailUrl: z.string(),
  messages: z.array(messageDetailSchema),
});
export type ThreadDetail = z.infer<typeof threadDetailSchema>;

export const settingsSchema = z.object({
  includeAllCategories: z.boolean(),
  feedWindowHours: z.number().int().min(1).max(168),
});
export type Settings = z.infer<typeof settingsSchema>;

export const updateSettingsRequestSchema = settingsSchema.partial();
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;
