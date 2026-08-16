import { eq, and, desc, isNull, count } from "drizzle-orm";
import type { Notification, NotificationPushRequest } from "@congress/shared-types";
import { db } from "./db/client.js";
import { notifications } from "./db/schema.js";

const LIST_LIMIT = 50;

function toNotification(row: typeof notifications.$inferSelect): Notification {
  return {
    id: row.id,
    chamber: row.chamber,
    title: row.title,
    body: row.body,
    chamberUrl: row.chamberUrl,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
  };
}

// Upserts on (chamber, dedupeKey) - see the notifications table's own
// comment in db/schema.ts. Re-marking a notification unread on every push
// would make a merely-unchanged re-push (the same still-true condition,
// polled again) nag the bell repeatedly, so `readAt` is only cleared when
// the visible content actually changed, or the row didn't exist yet.
export function pushNotification(push: NotificationPushRequest): void {
  const existing = db
    .select()
    .from(notifications)
    .where(and(eq(notifications.chamber, push.chamber), eq(notifications.dedupeKey, push.dedupeKey)))
    .get();

  if (push.withdraw) {
    if (existing) db.delete(notifications).where(eq(notifications.id, existing.id)).run();
    return;
  }

  const body = push.body ?? null;
  const chamberUrl = push.chamberUrl ?? null;

  if (!existing) {
    db.insert(notifications)
      .values({
        chamber: push.chamber,
        dedupeKey: push.dedupeKey,
        title: push.title!,
        body,
        chamberUrl,
        createdAt: new Date(),
        readAt: null,
      })
      .run();
    return;
  }

  const changed = existing.title !== push.title || existing.body !== body || existing.chamberUrl !== chamberUrl;
  db.update(notifications)
    .set({ title: push.title!, body, chamberUrl, readAt: changed ? null : existing.readAt })
    .where(eq(notifications.id, existing.id))
    .run();
}

export function listNotifications(): { notifications: Notification[]; unreadCount: number } {
  const rows = db.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(LIST_LIMIT).all();
  const unreadCount = db
    .select({ n: count() })
    .from(notifications)
    .where(isNull(notifications.readAt))
    .get()!.n;
  return { notifications: rows.map(toNotification), unreadCount };
}

export function markNotificationRead(id: number): boolean {
  const result = db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, id)).run();
  return result.changes > 0;
}

export function markAllNotificationsRead(): void {
  db.update(notifications).set({ readAt: new Date() }).where(isNull(notifications.readAt)).run();
}

export function dismissNotification(id: number): boolean {
  const result = db.delete(notifications).where(eq(notifications.id, id)).run();
  return result.changes > 0;
}
