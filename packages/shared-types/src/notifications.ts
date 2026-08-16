import { z } from "zod";

// Pushed by a Chamber to Capitol's notification center - task due, event
// starting soon, or any other "the owner should know about this" moment.
// `dedupeKey` scopes idempotency to (chamber, dedupeKey): re-pushing the
// same key upserts the existing row instead of creating a duplicate, so a
// Chamber's own poller can call this on every tick while a condition still
// holds without spamming the center. `withdraw: true` removes the row
// instead (the condition no longer applies - task completed, event passed)
// - title/body/chamberUrl are meaningless then, so only `title` is required
// when not withdrawing.
export const notificationPushRequestSchema = z
  .object({
    chamber: z.string().min(1),
    dedupeKey: z.string().min(1),
    title: z.string().min(1).optional(),
    body: z.string().optional(),
    // Path relative to the owning Chamber's own root (e.g. "/t/42"), same
    // convention as an Exhibit's own `url` - the notification center
    // resolves it through resolveChamberPath/navigateToExhibit rather than
    // storing a chamber-prefixed path itself.
    chamberUrl: z.string().optional(),
    withdraw: z.boolean().optional(),
  })
  .refine((v) => v.withdraw === true || (v.title !== undefined && v.title.length > 0), {
    message: "title is required unless withdraw is true",
    path: ["title"],
  });
export type NotificationPushRequest = z.infer<typeof notificationPushRequestSchema>;

export const notificationSchema = z.object({
  id: z.number().int(),
  chamber: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  chamberUrl: z.string().nullable(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationsListResponseSchema = z.object({
  notifications: z.array(notificationSchema),
  unreadCount: z.number().int(),
});
export type NotificationsListResponse = z.infer<typeof notificationsListResponseSchema>;
