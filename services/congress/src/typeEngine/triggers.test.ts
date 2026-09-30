import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrationsDir } from "@congress/test-support";
import { runMigrations } from "../db/client.js";
import { onEventPublished, type PublishedEvent } from "../events.js";
import { exhibitsDb } from "./db/client.js";
import { runExhibitsMigrations } from "./db/client.js";
import { recordTriggerState } from "./db/schema.js";
import { getTypeBySlug, publish } from "./store.js";
import { createRecord, deleteRecord, getRecord, updateRecord } from "./records.js";
import { typeEventCatalog } from "./source.js";
import { evaluateAll, MAX_TIMEOUT_MS, nextWakeAt, startTimeTriggers, stepReached, stopTimeTriggers } from "./triggers.js";

// Zagreb is UTC+2 until 25 Oct: a date's day ends at 22:00Z.
const START = new Date("2026-09-30T10:00:00Z");
const events: PublishedEvent[] = [];
onEventPublished((e) => {
  if (e.type.startsWith("chore.")) events.push(e);
});
const seen = () => events.map((e) => `${e.type}:${(e.payload as { title: string }).title}`);

beforeAll(async () => {
  vi.useFakeTimers({ now: START, toFake: ["Date", "setTimeout", "clearTimeout"] });
  runMigrations(migrationsDir("congress"));
  runExhibitsMigrations();
  publish({
    actor: "test",
    ops: [
      { op: "create_type", slug: "chore", label: "Chore" },
      { op: "add_field", slug: "title", label: "Title", kind: "text", options: { required: true } },
      { op: "set_title_field", field: "title" },
      { op: "add_field", slug: "due", label: "Due", kind: "date" },
      { op: "add_field", slug: "done", label: "Done", kind: "boolean" },
      { op: "add_field", slug: "done_at", label: "Done at", kind: "datetime", options: { readonly: true } },
      { op: "set_actions", actions: [{ kind: "toggle", field: "done", on: "Reopen", off: "Done", onEvent: "done", offEvent: "undone", stampField: "done_at" }] },
      {
        op: "set_time_triggers",
        triggers: [
          {
            field: "due",
            and: [{ field: "done", value: false }],
            steps: [
              { event: "due_soon", label: "Due soon", offsetMinutes: -1440 },
              { event: "overdue", label: "Overdue", offsetMinutes: 0 },
            ],
            clearEvent: { event: "cleared", label: "No longer due" },
          },
        ],
      },
    ],
  });
  await startTimeTriggers();
});

afterAll(() => {
  stopTimeTriggers();
  vi.useRealTimers();
});

beforeEach(() => {
  events.length = 0;
});

describe("time-trigger ladders", () => {
  it("picks the latest step reached", () => {
    const steps = [
      { event: "soon", label: "s", offsetMinutes: -60 },
      { event: "late", label: "l", offsetMinutes: 0 },
    ];
    const at = 100 * 60_000;
    expect(stepReached(at, steps, 39 * 60_000)).toBeNull();
    expect(stepReached(at, steps, 40 * 60_000)?.event).toBe("soon");
    expect(stepReached(at, steps, at)?.event).toBe("late");
  });

  it("lists ladder and toggle events in the event catalog", () => {
    const types = typeEventCatalog()[0]!.events.filter((e) => e.type.startsWith("chore.")).map((e) => `${e.type}|${e.label}`);
    expect(types).toEqual(
      expect.arrayContaining(["chore.due_soon|Due soon", "chore.overdue|Overdue", "chore.cleared|No longer due", "chore.done|Chore done", "chore.undone|Chore undone"])
    );
  });

  let rent: string;
  let old: string;

  it("fires nothing for a future date and wakes at its first step", () => {
    rent = createRecord("chore", { title: "Rent", due: "2026-10-02" }).id;
    expect(seen()).toEqual(["chore.created:Rent"]);
    expect(nextWakeAt()).toBe(Date.parse("2026-10-01T22:00:00Z"));
  });

  it("fires only the latest step for a record created already past it", () => {
    old = createRecord("chore", { title: "Taxes", due: "2026-09-28" }).id;
    expect(seen()).toEqual(["chore.created:Taxes", "chore.overdue:Taxes"]);
  });

  it("fires due_soon on time when the timer wakes", async () => {
    await vi.advanceTimersByTimeAsync(Date.parse("2026-10-01T22:00:00Z") - Date.now());
    expect(seen()).toEqual(["chore.due_soon:Rent"]);
    expect(nextWakeAt()).toBe(Date.parse("2026-10-02T22:00:00Z"));
  });

  it("clears at once when completed, stamps the time and fires the toggle event", () => {
    const done = updateRecord(rent, { done: true });
    expect(done.values.done_at).toBe(new Date(Date.now()).toISOString());
    expect(seen()).toEqual(["chore.updated:Rent", "chore.done:Rent", "chore.cleared:Rent"]);
  });

  it("re-enters the ladder when reopened and clears the stamp", () => {
    const reopened = updateRecord(rent, { done: false });
    expect(reopened.values.done_at).toBeNull();
    expect(seen()).toEqual(["chore.updated:Rent", "chore.undone:Rent", "chore.due_soon:Rent"]);
  });

  it("clears when the date moves out of range", () => {
    updateRecord(rent, { due: "2026-12-01" });
    expect(seen()).toEqual(["chore.updated:Rent", "chore.cleared:Rent"]);
  });

  it("clears on delete, keeping the title", () => {
    deleteRecord(old);
    expect(seen()).toEqual(["chore.deleted:Taxes", "chore.cleared:Taxes"]);
    expect(exhibitsDb.select().from(recordTriggerState).all().map((r) => r.recordId)).not.toContain(old);
  });

  it("doesn't refire a state carried over by an import", () => {
    const imported = createRecord("chore", { title: "Imported", due: "2026-09-01" }, { silent: true }).id;
    exhibitsDb
      .insert(recordTriggerState)
      .values({ recordId: imported, typeId: getTypeBySlug("chore")!.id, ladder: "fld_due", state: "overdue", firedAt: new Date() })
      .run();
    evaluateAll();
    expect(seen()).toEqual([]);
    expect(getRecord(imported)?.values.title).toBe("Imported");
  });

  it("doesn't announce past steps when a ladder is added to records that exist", async () => {
    const t = getTypeBySlug("chore")!;
    const late = createRecord("chore", { title: "Long overdue", due: "2026-08-01" }).id;
    const soon = createRecord("chore", { title: "Tomorrow", due: "2026-10-02" }).id;
    // Done two hours before the ladder exists: its step is already in the past.
    const finished = createRecord("chore", { title: "Finished", done: true }).id;
    await vi.advanceTimersByTimeAsync(2 * 3_600_000);
    events.length = 0;
    publish({
      typeId: t.id,
      actor: "test",
      ops: [
        {
          op: "set_time_triggers",
          triggers: [
            ...t.definition.timeTriggers,
            { field: "done_at", steps: [{ event: "done_long_ago", label: "Done a while ago", offsetMinutes: 60 }] },
          ],
        },
      ],
    });
    expect(seen()).toEqual([]);
    updateRecord(late, { done: true });
    expect(seen()).toEqual(["chore.updated:Long overdue", "chore.done:Long overdue", "chore.cleared:Long overdue"]);
    events.length = 0;
    // Its done_at is now: the new ladder is known, so an hour later it fires.
    await vi.advanceTimersByTimeAsync(61 * 60_000);
    expect(seen()).toEqual(["chore.done_long_ago:Long overdue"]);
    deleteRecord(soon);
    deleteRecord(finished);
  });

  it("wakes at most every MAX_TIMEOUT_MS for far-off dates", async () => {
    updateRecord(rent, { due: "2027-06-01" });
    events.length = 0;
    await vi.advanceTimersByTimeAsync(MAX_TIMEOUT_MS);
    expect(seen()).toEqual([]);
    // Due 1 Jun ends at 22:00Z that day; due_soon is 24h before.
    expect(nextWakeAt()).toBe(Date.parse("2027-05-31T22:00:00Z"));
  });
});
