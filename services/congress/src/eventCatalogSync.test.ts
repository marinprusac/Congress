import { sql } from "drizzle-orm";
import { migrationsDir } from "@congress/test-support";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The catalog is derived from the running connectors' declared events.
vi.mock("./connectors/runtime.js", () => ({ listConnectors: vi.fn(() => []) }));
import { listConnectors } from "./connectors/runtime.js";

import { db, runMigrations } from "./db/client.js";
import { eventSettings } from "./db/schema.js";
import { syncEventCatalog } from "./eventCatalogSync.js";
import { getEventSettingsRowByType } from "./eventSettings.js";

beforeAll(() => runMigrations(migrationsDir("congress")));

beforeEach(() => {
  db.run(sql`delete from event_settings`);
});

function stubRegistry(chambers: Array<{ name: string; events: unknown[] }>) {
  vi.mocked(listConnectors).mockReturnValue(chambers as never);
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
  it("derives rows for Congress's synthetic events even with no connectors running", () => {
    stubRegistry([]);

    syncEventCatalog();

    expect(getEventSettingsRowByType("google.account_connected")?.chamber).toBe("congress");
    expect(getEventSettingsRowByType("logs.rule_updated")?.chamber).toBe("congress");
  });
});
