import { sql } from "drizzle-orm";
import { migrationsDir } from "@congress/test-support";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The catalog is derived from Congress's own registry, read in-process.
vi.mock("./registry.js", () => ({ listChambers: vi.fn(() => []), getChamber: vi.fn() }));
import { listChambers } from "./registry.js";

import { db, runMigrations } from "./db/client.js";
import { eventSettings } from "./db/schema.js";
import { syncEventCatalog } from "./eventCatalogSync.js";
import { getEventSettingsRowByType } from "./eventSettings.js";

beforeAll(() => runMigrations(migrationsDir("congress")));

beforeEach(() => {
  db.run(sql`delete from event_settings`);
});

function stubRegistry(chambers: Array<{ name: string; events: unknown[] }>) {
  vi.mocked(listChambers).mockReturnValue(chambers as never);
}

describe("syncEventCatalog", () => {
  it("caches a newly-declared event type's payloadFields on insert", () => {
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

    syncEventCatalog();

    const row = getEventSettingsRowByType("tasks.due_soon");
    expect(row?.payloadFieldsJson).not.toBeNull();
    expect(JSON.parse(row!.payloadFieldsJson!)).toEqual({
      taskId: { type: "string" },
      name: { type: "string" },
    });
  });

  it("stores null when an event type declares no payloadFields", () => {
    stubRegistry([{ name: "tasks", events: [{ type: "tasks.deleted", label: "Task deleted" }] }]);

    syncEventCatalog();

    expect(getEventSettingsRowByType("tasks.deleted")?.payloadFieldsJson).toBeNull();
  });

  it("refreshes payloadFields on an existing row without touching the owner's own configuration", () => {
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

    syncEventCatalog();

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

describe("syncEventCatalog (Congress's own events)", () => {
  it("derives rows for Congress's synthetic events even with an empty registry", () => {
    stubRegistry([]);

    syncEventCatalog();

    expect(getEventSettingsRowByType("congress.chamber_offline")?.chamber).toBe("congress");
    expect(getEventSettingsRowByType("logs.rule_updated")?.chamber).toBe("congress");
  });
});
