import { eq, sql } from "drizzle-orm";
import { migrationsDir } from "@congress/test-support";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./pushSubscriptions.js", () => ({
  sendWebPush: vi.fn().mockResolvedValue(undefined),
  publicKey: () => null,
  saveSubscription: vi.fn(),
  removeSubscription: vi.fn(),
}));

import { sendWebPush } from "./pushSubscriptions.js";
import { db, runMigrations } from "./db/client.js";
import { notifications } from "./db/schema.js";
import {
  dismissNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  pushNotification,
} from "./notifications.js";

beforeAll(() => runMigrations(migrationsDir("chamber-logs")));

beforeEach(() => {
  db.run(sql`delete from notifications`);
  vi.mocked(sendWebPush).mockClear();
});

function push(overrides: Partial<Parameters<typeof pushNotification>[0]> = {}) {
  pushNotification({ chamber: "tasks", dedupeKey: "task-1", title: "Taxes due", ...overrides });
}

// The inbox shows current state, not a log - so a condition that is still
// true on the next poll has to update the one notification in place. The
// rule that makes that bearable is that an *unchanged* re-push is silent:
// it neither un-reads the row nor buzzes the owner's phone again.
describe("pushNotification", () => {
  it("creates a notification and buzzes subscribed devices", () => {
    push();
    expect(listNotifications().notifications).toHaveLength(1);
    expect(sendWebPush).toHaveBeenCalledTimes(1);
  });

  it("upserts on (chamber, dedupeKey) rather than piling up duplicates", () => {
    push();
    push();
    push();
    expect(listNotifications().notifications).toHaveLength(1);
  });

  it("keeps notifications from different chambers apart even under the same key", () => {
    push({ chamber: "tasks" });
    push({ chamber: "calendar" });
    expect(listNotifications().notifications).toHaveLength(2);
  });

  it("does not buzz devices again for an unchanged re-push", () => {
    push();
    vi.mocked(sendWebPush).mockClear();
    push();
    expect(sendWebPush).not.toHaveBeenCalled();
  });

  it("does not mark an already-read notification unread on an unchanged re-push", () => {
    push();
    markNotificationRead(listNotifications().notifications[0]!.id);
    push();
    expect(listNotifications().unreadCount).toBe(0);
  });

  it("buzzes again and un-reads when the title changes", () => {
    push({ title: "Taxes due" });
    markNotificationRead(listNotifications().notifications[0]!.id);
    vi.mocked(sendWebPush).mockClear();

    push({ title: "Taxes overdue" });
    expect(sendWebPush).toHaveBeenCalledTimes(1);
    expect(listNotifications().unreadCount).toBe(1);
  });

  it("treats a changed body as a change", () => {
    push({ body: "due tomorrow" });
    markNotificationRead(listNotifications().notifications[0]!.id);
    push({ body: "due today" });
    expect(listNotifications().unreadCount).toBe(1);
  });

  it("treats a changed link as a change", () => {
    push({ chamberUrl: "/t/1" });
    markNotificationRead(listNotifications().notifications[0]!.id);
    push({ chamberUrl: "/t/2" });
    expect(listNotifications().unreadCount).toBe(1);
  });

  it("treats an absent body the same as an explicit null, so it is not a spurious change", () => {
    push({ body: undefined });
    markNotificationRead(listNotifications().notifications[0]!.id);
    vi.mocked(sendWebPush).mockClear();

    push({ body: undefined });
    expect(sendWebPush).not.toHaveBeenCalled();
    expect(listNotifications().unreadCount).toBe(0);
  });

  it("passes the originating chamber and link through to the device push", () => {
    push({ chamber: "calendar", title: "Standup in 5", body: "Daily", chamberUrl: "/c/1" });
    expect(sendWebPush).toHaveBeenCalledWith({
      title: "Standup in 5",
      body: "Daily",
      chamber: "calendar",
      chamberUrl: "/c/1",
    });
  });
});

describe("reading and dismissing", () => {
  it("counts only unread notifications", () => {
    push({ dedupeKey: "a" });
    push({ dedupeKey: "b" });
    expect(listNotifications().unreadCount).toBe(2);

    markNotificationRead(listNotifications().notifications[0]!.id);
    expect(listNotifications().unreadCount).toBe(1);
  });

  it("marks everything read at once", () => {
    push({ dedupeKey: "a" });
    push({ dedupeKey: "b" });
    markAllNotificationsRead();
    expect(listNotifications().unreadCount).toBe(0);
  });

  it("reports whether the notification it was asked about existed", () => {
    push();
    const id = listNotifications().notifications[0]!.id;
    expect(markNotificationRead(id)).toBe(true);
    expect(markNotificationRead(9999)).toBe(false);
    expect(dismissNotification(id)).toBe(true);
    expect(dismissNotification(id)).toBe(false);
  });

  it("deletes a dismissed notification outright, so a still-true condition can recreate it", () => {
    push();
    dismissNotification(listNotifications().notifications[0]!.id);
    expect(listNotifications().notifications).toHaveLength(0);

    push();
    expect(listNotifications().notifications).toHaveLength(1);
    expect(listNotifications().unreadCount).toBe(1);
  });

  it("lists newest first", () => {
    push({ dedupeKey: "older", title: "Older" });
    db.update(notifications).set({ createdAt: new Date(0) }).where(eq(notifications.dedupeKey, "older")).run();
    push({ dedupeKey: "newer", title: "Newer" });

    expect(listNotifications().notifications.map((n) => n.title)).toEqual(["Newer", "Older"]);
  });
});
