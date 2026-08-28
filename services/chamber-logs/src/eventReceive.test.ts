import { eq, sql } from "drizzle-orm";
import { migrationsDir } from "@congress/test-support";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Web Push delivery is a separate concern with its own tests; stubbing it
// keeps these off the network and lets them assert on what would have been
// pushed.
vi.mock("./pushSubscriptions.js", () => ({
  sendWebPush: vi.fn().mockResolvedValue(undefined),
  publicKey: () => null,
  saveSubscription: vi.fn(),
  removeSubscription: vi.fn(),
}));

import { db, runMigrations } from "./db/client.js";
import { eventHistory, eventSettings, notifications } from "./db/schema.js";
import { handleReceivedEvent } from "./eventReceive.js";
import { listHistory } from "./eventHistory.js";
import { listNotifications } from "./notifications.js";

beforeAll(() => runMigrations(migrationsDir("chamber-logs")));

beforeEach(() => {
  db.run(sql`delete from event_history`);
  db.run(sql`delete from notifications`);
  db.run(sql`delete from event_settings`);
});

type SettingsOverrides = Partial<typeof eventSettings.$inferInsert>;

function settingsFor(eventType: string, overrides: SettingsOverrides = {}) {
  return db
    .insert(eventSettings)
    .values({
      eventType,
      chamber: "tasks",
      label: "Task due soon",
      description: "A task is coming up",
      recordToHistory: false,
      notify: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    })
    .returning()
    .get();
}

function deliver(type: string, payload: Record<string, unknown> = {}) {
  return handleReceivedEvent({
    chamber: "tasks",
    type,
    payload,
    occurredAt: "2026-03-01T08:00:00.000Z",
  });
}

describe("an event type with no settings row", () => {
  it("is ignored entirely", async () => {
    await deliver("tasks.unknown", { priority: "urgent" });
    expect(listHistory()).toHaveLength(0);
    expect(listNotifications().notifications).toHaveLength(0);
  });
});

describe("an inert settings row", () => {
  it("does nothing when both actions are off, and does not record a firing", async () => {
    settingsFor("tasks.due_soon");
    await deliver("tasks.due_soon");

    expect(listHistory()).toHaveLength(0);
    expect(listNotifications().notifications).toHaveLength(0);
    expect(db.select().from(eventSettings).get()?.lastFiredAt).toBeNull();
  });
});

describe("the two actions gate independently", () => {
  it("records without notifying", async () => {
    settingsFor("tasks.due_soon", { recordToHistory: true });
    await deliver("tasks.due_soon");

    expect(listHistory()).toHaveLength(1);
    expect(listNotifications().notifications).toHaveLength(0);
  });

  it("notifies without recording", async () => {
    settingsFor("tasks.due_soon", { notify: true });
    await deliver("tasks.due_soon");

    expect(listHistory()).toHaveLength(0);
    expect(listNotifications().notifications).toHaveLength(1);
  });

  it("does both when both are on", async () => {
    settingsFor("tasks.due_soon", { recordToHistory: true, notify: true });
    await deliver("tasks.due_soon");

    expect(listHistory()).toHaveLength(1);
    expect(listNotifications().notifications).toHaveLength(1);
  });

  it("applies a separate priority floor to each, so recording can be noisier than notifying", async () => {
    settingsFor("tasks.due_soon", {
      recordToHistory: true,
      historyMinPriority: "low",
      notify: true,
      notifyMinPriority: "high",
    });

    await deliver("tasks.due_soon", { priority: "normal" });
    expect(listHistory()).toHaveLength(1);
    expect(listNotifications().notifications).toHaveLength(0);

    await deliver("tasks.due_soon", { priority: "urgent" });
    expect(listHistory()).toHaveLength(2);
    expect(listNotifications().notifications).toHaveLength(1);
  });

  it("treats a threshold as inclusive", async () => {
    settingsFor("tasks.due_soon", { notify: true, notifyMinPriority: "high" });
    await deliver("tasks.due_soon", { priority: "high" });
    expect(listNotifications().notifications).toHaveLength(1);
  });
});

describe("priority defaulting", () => {
  it("treats an event with no priority as normal", async () => {
    settingsFor("tasks.due_soon", { recordToHistory: true, historyMinPriority: "normal" });
    await deliver("tasks.due_soon");
    expect(listHistory()[0]?.priority).toBe("normal");
  });

  it("treats an unrecognized priority as normal rather than rejecting the event", async () => {
    settingsFor("tasks.due_soon", { recordToHistory: true, historyMinPriority: "normal" });
    await deliver("tasks.due_soon", { priority: "catastrophic" });
    expect(listHistory()[0]?.priority).toBe("normal");
  });

  it("stores the priority so a filtered widget query can use it", async () => {
    settingsFor("tasks.overdue", { recordToHistory: true });
    await deliver("tasks.overdue", { priority: "urgent" });

    expect(listHistory({ minPriority: "high" })).toHaveLength(1);
    expect(listHistory({ minPriority: "urgent" })).toHaveLength(1);
  });

  it("excludes a below-threshold row from a filtered query", async () => {
    settingsFor("tasks.due_soon", { recordToHistory: true });
    await deliver("tasks.due_soon", { priority: "low" });
    expect(listHistory({ minPriority: "high" })).toHaveLength(0);
    expect(listHistory()).toHaveLength(1);
  });
});

describe("notification content", () => {
  it("interpolates the payload into the templates", async () => {
    settingsFor("tasks.due_soon", {
      notify: true,
      notifyTitleTemplate: "{{payload.name}} is due",
      notifyBodyTemplate: "Task #{{payload.taskId}}",
      notifyUrlTemplate: "/t/{{payload.taskId}}",
    });
    await deliver("tasks.due_soon", { name: "Taxes", taskId: 7 });

    expect(listNotifications().notifications[0]).toMatchObject({
      title: "Taxes is due",
      body: "Task #7",
      chamberUrl: "/t/7",
    });
  });

  it("falls back to the cached label and description when no template is set", async () => {
    settingsFor("tasks.due_soon", { notify: true });
    await deliver("tasks.due_soon");

    expect(listNotifications().notifications[0]).toMatchObject({
      title: "Task due soon",
      body: "A task is coming up",
    });
  });

  it("attributes the notification to the chamber that published the event, not to Logs", async () => {
    // The bell icons and links by originating chamber; this Chamber is only
    // the one deciding whether to push.
    settingsFor("tasks.due_soon", { notify: true });
    await deliver("tasks.due_soon");
    expect(listNotifications().notifications[0]?.chamber).toBe("tasks");
  });
});

describe("notification deduplication", () => {
  it("collapses repeat firings of the same still-true condition into one notification", async () => {
    settingsFor("tasks.due_soon", { notify: true });
    await deliver("tasks.due_soon");
    await deliver("tasks.due_soon");
    await deliver("tasks.due_soon");

    expect(listNotifications().notifications).toHaveLength(1);
  });

  it("keeps separate notifications when the key is templated per entity", async () => {
    settingsFor("tasks.due_soon", {
      notify: true,
      notifyDedupeKeyTemplate: "task-{{payload.taskId}}",
      notifyTitleTemplate: "{{payload.name}}",
    });
    await deliver("tasks.due_soon", { taskId: 1, name: "One" });
    await deliver("tasks.due_soon", { taskId: 2, name: "Two" });

    expect(listNotifications().notifications).toHaveLength(2);
  });

  it("records every firing in history even as notifications collapse", async () => {
    // History is genuinely append-only: it shows what happened over time,
    // including repeats. The inbox shows current state.
    settingsFor("tasks.due_soon", { recordToHistory: true, notify: true });
    await deliver("tasks.due_soon");
    await deliver("tasks.due_soon");

    expect(listHistory()).toHaveLength(2);
    expect(listNotifications().notifications).toHaveLength(1);
  });

  it("leaves an unchanged re-push marked read, so a still-true condition stops nagging", async () => {
    settingsFor("tasks.due_soon", { notify: true });
    await deliver("tasks.due_soon");

    const id = listNotifications().notifications[0]!.id;
    db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, id)).run();

    await deliver("tasks.due_soon");
    expect(listNotifications().unreadCount).toBe(0);
  });

  it("marks a changed notification unread again, since it now says something new", async () => {
    settingsFor("tasks.due_soon", { notify: true, notifyTitleTemplate: "{{payload.name}} is due" });
    await deliver("tasks.due_soon", { name: "Taxes" });

    const id = listNotifications().notifications[0]!.id;
    db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, id)).run();

    await deliver("tasks.due_soon", { name: "Rent" });
    expect(listNotifications().unreadCount).toBe(1);
    expect(listNotifications().notifications[0]?.title).toBe("Rent is due");
  });
});

describe("lastFiredAt", () => {
  it("is stamped when an action actually ran", async () => {
    settingsFor("tasks.due_soon", { recordToHistory: true });
    await deliver("tasks.due_soon");
    expect(db.select().from(eventSettings).get()?.lastFiredAt).not.toBeNull();
  });

  it("is not stamped when every action was gated out by its threshold", async () => {
    settingsFor("tasks.due_soon", {
      recordToHistory: true,
      historyMinPriority: "urgent",
      notify: true,
      notifyMinPriority: "urgent",
    });
    await deliver("tasks.due_soon", { priority: "low" });
    expect(db.select().from(eventSettings).get()?.lastFiredAt).toBeNull();
  });
});

describe("history retention", () => {
  it("computes an expiry from the event type's own retention at write time", async () => {
    settingsFor("tasks.due_soon", { recordToHistory: true, historyRetentionMs: 60_000 });
    await deliver("tasks.due_soon");

    const row = db.select().from(eventHistory).get()!;
    expect(row.expiresAt.getTime() - row.occurredAt.getTime()).toBe(60_000);
  });

  it("falls back to the 90-day default when the event type sets no retention", async () => {
    settingsFor("tasks.due_soon", { recordToHistory: true });
    await deliver("tasks.due_soon");

    const row = db.select().from(eventHistory).get()!;
    expect(row.expiresAt.getTime() - row.occurredAt.getTime()).toBe(90 * 24 * 60 * 60 * 1000);
  });

  it("keeps the event's own occurredAt rather than the moment it was received", async () => {
    settingsFor("tasks.due_soon", { recordToHistory: true });
    await deliver("tasks.due_soon");
    expect(listHistory()[0]?.occurredAt).toBe("2026-03-01T08:00:00.000Z");
  });
});
