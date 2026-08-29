import { sql } from "drizzle-orm";
import { migrationsDir } from "@congress/test-support";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, runMigrations } from "./db/client.js";
import { eventSettings } from "./db/schema.js";
import { syncEventCatalog } from "./eventCatalogSync.js";
import { getEventSettingsRowByType } from "./eventSettings.js";

beforeAll(() => runMigrations(migrationsDir("chamber-logs")));

beforeEach(() => {
  db.run(sql`delete from event_settings`);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubRegistry(chambers: Array<{ name: string; events: unknown[] }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(chambers),
    })
  );
}

describe("syncEventCatalog", () => {
  it("caches a newly-declared event type's payloadFields on insert", async () => {
    stubRegistry([
      {
        name: "tasks",
        events: [
          {
            type: "tasks.due_soon",
            label: "Task due soon",
            payloadFields: { taskId: { type: "string" }, name: { type: "string" } },
          },
        ],
      },
    ]);

    await syncEventCatalog();

    const row = getEventSettingsRowByType("tasks.due_soon");
    expect(row?.payloadFieldsJson).not.toBeNull();
    expect(JSON.parse(row!.payloadFieldsJson!)).toEqual({
      taskId: { type: "string" },
      name: { type: "string" },
    });
  });

  it("stores null when an event type declares no payloadFields", async () => {
    stubRegistry([{ name: "tasks", events: [{ type: "tasks.deleted", label: "Task deleted" }] }]);

    await syncEventCatalog();

    expect(getEventSettingsRowByType("tasks.deleted")?.payloadFieldsJson).toBeNull();
  });

  it("refreshes payloadFields on an existing row without touching the owner's own configuration", async () => {
    db.insert(eventSettings)
      .values({
        eventType: "tasks.due_soon",
        chamber: "tasks",
        label: "Task due soon",
        payloadFieldsJson: JSON.stringify({ taskId: { type: "string" } }),
        recordToHistory: true,
        notify: true,
        notifyTitleTemplate: "{{payload.name}} is due",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    stubRegistry([
      {
        name: "tasks",
        events: [
          {
            type: "tasks.due_soon",
            label: "Task due soon",
            payloadFields: { taskId: { type: "string" }, name: { type: "string" }, url: { type: "string" } },
          },
        ],
      },
    ]);

    await syncEventCatalog();

    const row = getEventSettingsRowByType("tasks.due_soon");
    expect(JSON.parse(row!.payloadFieldsJson!)).toEqual({
      taskId: { type: "string" },
      name: { type: "string" },
      url: { type: "string" },
    });
    expect(row?.notify).toBe(true);
    expect(row?.notifyTitleTemplate).toBe("{{payload.name}} is due");
  });
});
