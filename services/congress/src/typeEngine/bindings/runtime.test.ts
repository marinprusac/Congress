import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrationsDir } from "@congress/test-support";
import { runMigrations } from "../../db/client.js";
import { onEventPublished, type PublishedEvent } from "../../events.js";
import { runExhibitsMigrations } from "../db/client.js";
import { getTypeBySlug, publish, PublishError } from "../store.js";
import { createRecord, deleteRecord, getRecord, listRecords, RecordLockedError, updateRecord } from "../records.js";
import { ConnectorRefusedError, defineConnector, type SourceRecord, type SourceValue } from "../../connectors/contract.js";
import { startConnectors, stopConnectors } from "../../connectors/registry.js";
import { flushOutbox, reconcile, runBindingAction, startBindings, stopBindings, withBinding } from "./runtime.js";

// An in-memory calendar standing in for Google.
interface Item {
  values: Record<string, SourceValue>;
  facts: Record<string, SourceValue>;
}
const store = new Map<string, Item>();
let nextKey = 1;
let failNext: Error | null = null;
const calls: string[] = [];
let emit: (key: string, deleted?: boolean) => void = () => {};

const toRecord = (key: string, item: Item): SourceRecord => ({ kind: "event", key, values: { ...item.values }, facts: { ...item.facts }, updatedAt: null });
function maybeFail() {
  const err = failNext;
  failNext = null;
  if (err) throw err;
}

const fakeCal = defineConnector({
  name: "fake-cal",
  label: "Fake Calendar",
  source: [
    {
      kind: "event",
      label: "Event",
      fields: [
        { slug: "title", kind: "text", label: "Title" },
        { slug: "notes", kind: "text", label: "Notes" },
        { slug: "calendar", kind: "text", label: "Calendar" },
        { slug: "response", kind: "text", label: "Response" },
        { slug: "link", kind: "text", label: "Link" },
      ],
      facts: [
        { slug: "editable", label: "Editable" },
        { slug: "canRsvp", label: "Can answer" },
      ],
    },
  ],
  start: (ctx) => {
    emit = (key, deleted) => ctx.emitChange("event", key, deleted);
  },
  sync: async () => ({ changed: 0, error: null }),
  intervalMs: () => 3_600_000,
  read: {
    get: (_kind, key) => (store.has(key) ? toRecord(key, store.get(key)!) : null),
    list: () => [...store].map(([k, v]) => toRecord(k, v)),
    targets: () => [{ value: "cal-a", label: "A" }, { value: "cal-b", label: "B" }],
  },
  push: {
    async create(ctx, _kind, values) {
      calls.push(`create ${values.calendar}`);
      maybeFail();
      const key = `k${nextKey++}`;
      store.set(key, { values: { ...values, response: null, link: `https://x/${key}` }, facts: { editable: true, canRsvp: false } });
      ctx.emitChange("event", key);
      return toRecord(key, store.get(key)!);
    },
    async update(ctx, _kind, key, patch) {
      calls.push(`update ${key} ${Object.keys(patch).join(",")}`);
      maybeFail();
      const item = store.get(key)!;
      if (!item.facts.editable) throw new ConnectorRefusedError("not editable");
      Object.assign(item.values, patch);
      ctx.emitChange("event", key);
      return toRecord(key, item);
    },
    async delete(ctx, _kind, key) {
      calls.push(`delete ${key}`);
      maybeFail();
      store.delete(key);
      ctx.emitChange("event", key, true);
    },
    async act(ctx, _kind, key, action, args) {
      calls.push(`${action} ${key}`);
      const item = store.get(key)!;
      item.values.response = args.response ?? null;
      ctx.emitChange("event", key);
      return toRecord(key, item);
    },
  },
});

function seed(key: string, values: Partial<Record<string, SourceValue>>, facts: Record<string, SourceValue> = { editable: true, canRsvp: false }) {
  store.set(key, { values: { title: "", notes: "", calendar: "cal-a", response: null, link: `https://x/${key}`, ...values }, facts });
}

const events: PublishedEvent[] = [];
onEventPublished((e) => events.push(e));
let backfillEvents = -1;

const all = () => listRecords("event", { limit: 500 });
const byKey = (key: string) => all().find((r) => r.provenance?.key === key)!;

beforeAll(async () => {
  runMigrations(migrationsDir("congress"));
  runExhibitsMigrations();
  seed("s1", { title: "Standup" });
  seed("s2", { title: "Their party" }, { editable: false, canRsvp: true });
  startBindings();
  await startConnectors([fakeCal]);
  publish({
    actor: "test",
    ops: [
      { op: "create_type", slug: "event", label: "Event" },
      { op: "add_field", slug: "title", label: "Title", kind: "text", options: { required: true } },
      { op: "set_title_field", field: "title" },
      { op: "add_field", slug: "notes", label: "Notes", kind: "richtext" },
      { op: "add_field", slug: "calendar", label: "Calendar", kind: "text" },
      { op: "add_field", slug: "response", label: "Response", kind: "enum", options: { options: [{ value: "accepted", label: "Yes" }, { value: "declined", label: "No" }] } },
      { op: "add_field", slug: "hidden", label: "Hidden", kind: "boolean" },
      {
        op: "set_binding",
        binding: {
          connector: "fake-cal",
          kind: "event",
          label: "Fake Calendar",
          fields: [
            { source: "title", target: "title", mode: "sync" },
            { source: "notes", target: "notes", mode: "sync" },
            { source: "calendar", target: "calendar", mode: "sync" },
            { source: "response", target: "response", mode: "pull" },
          ],
          lock: { fact: "editable" },
          create: { targetField: "calendar" },
          delete: "push",
          actions: [{ id: "decline", label: "Decline", act: "rsvp", args: { response: "declined" }, when: [{ fact: "canRsvp" }], unless: [] }],
        },
      },
    ],
  });
  backfillEvents = events.filter((e) => e.type.startsWith("event.")).length;
});

afterAll(async () => {
  stopBindings();
  await stopConnectors();
});

beforeEach(() => {
  events.length = 0;
  calls.length = 0;
  failNext = null;
});

describe("pulling", () => {
  it("backfills quietly when a binding is published", () => {
    expect(all().map((r) => r.values.title).sort()).toEqual(["Standup", "Their party"]);
    expect(byKey("s1").provenance).toEqual({ binding: "bnd_fake-cal_event", key: "s1" });
    expect(backfillEvents).toBe(0);
  });

  it("applies source changes once, with events", () => {
    store.get("s1")!.values.title = "Standup (moved)";
    emit("s1");
    emit("s1");
    expect(byKey("s1").values.title).toBe("Standup (moved)");
    expect(events.filter((e) => e.type === "event.updated")).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor: "fake-cal", payload: { changed: ["title"] } });
  });

  it("keeps a record the source stops listing, and deletes one the source deleted", () => {
    seed("s3", { title: "Old" });
    emit("s3");
    const id = byKey("s3").id;
    store.delete("s3");
    expect(reconcile("fake-cal")).toBeGreaterThan(0);
    expect(getRecord(id)).not.toBeNull();
    expect(withBinding(getRecord(id)!).binding).toMatchObject({ locked: ["response", "title", "notes", "calendar"], lockReason: expect.stringMatching(/No longer in/) });
    emit("s3", true);
    expect(getRecord(id)).toBeNull();
  });

  it("offers the hybrid rest live", () => {
    expect(withBinding(byKey("s1")).binding!.live).toEqual({ link: "https://x/s1" });
  });
});

describe("pushing", () => {
  it("pushes an owner edit and absorbs the echo", async () => {
    const id = byKey("s1").id;
    updateRecord(id, { title: "Planning" }, { actor: "me" });
    await flushOutbox();
    expect(calls).toEqual(["update s1 title"]);
    expect(store.get("s1")!.values.title).toBe("Planning");
    expect(events.filter((e) => e.type === "event.updated")).toHaveLength(1);
    expect(withBinding(getRecord(id)!).binding!.pending).toBeNull();
  });

  it("keeps a pending edit through retries and pulls that didn't touch it", async () => {
    const id = byKey("s1").id;
    failNext = new Error("offline");
    updateRecord(id, { title: "Local" }, { actor: "me" });
    await flushOutbox();
    expect(withBinding(getRecord(id)!).binding!.pending).toMatchObject({ error: "offline", failed: false });
    store.get("s1")!.values.notes = "agenda";
    emit("s1");
    expect(getRecord(id)!.values).toMatchObject({ title: "Local", notes: "agenda" });
  });

  it("keeps rich chips while the source text still reads the same", async () => {
    const id = byKey("s1").id;
    updateRecord(id, { notes: "With [[exhibit:e:01aaaaaaaaaaaaaaaaaaaaaaaa|Ana]]" }, { actor: "me" });
    // Force the due retry of the earlier failed edit too.
    await vi.waitFor(async () => {
      await flushOutbox();
      expect(store.get("s1")!.values.notes).toBe("With Ana");
    });
    emit("s1");
    expect(getRecord(id)!.values.notes).toBe("With [[exhibit:e:01aaaaaaaaaaaaaaaaaaaaaaaa|Ana]]");
    store.get("s1")!.values.notes = "Rewritten in the source";
    emit("s1");
    expect(getRecord(id)!.values.notes).toBe("Rewritten in the source");
  });

  it("reverts an edit the source refuses", async () => {
    seed("s4", { title: "Shared" });
    emit("s4");
    const id = byKey("s4").id;
    updateRecord(id, { title: "Mine now" }, { actor: "me" });
    store.get("s4")!.facts.editable = false;
    await flushOutbox();
    expect(getRecord(id)!.values.title).toBe("Shared");
    expect(withBinding(getRecord(id)!).binding!.pending).toMatchObject({ failed: true, error: "not editable" });
  });

  it("creates at the source from a local record, without a duplicate", async () => {
    const before = all().length;
    const rec = createRecord("event", { title: "Dentist", calendar: "cal-a" }, { actor: "me" });
    await flushOutbox();
    expect(all()).toHaveLength(before + 1);
    const key = getRecord(rec.id)!.provenance!.key;
    expect(store.get(key)!.values).toMatchObject({ title: "Dentist", calendar: "cal-a" });
    // A local-only record stays local.
    const local = createRecord("event", { title: "Just mine" }, { actor: "me" });
    await flushOutbox();
    expect(getRecord(local.id)!.provenance).toBeNull();
  });

  it("moves between destinations under the same id, and back to local", async () => {
    const rec = createRecord("event", { title: "Trip", calendar: "cal-a" }, { actor: "me" });
    await flushOutbox();
    const oldKey = getRecord(rec.id)!.provenance!.key;
    updateRecord(rec.id, { calendar: "cal-b" }, { actor: "me" });
    await flushOutbox();
    const newKey = getRecord(rec.id)!.provenance!.key;
    expect(newKey).not.toBe(oldKey);
    expect(store.has(oldKey)).toBe(false);
    expect(store.get(newKey)!.values.calendar).toBe("cal-b");

    updateRecord(rec.id, { calendar: "" }, { actor: "me" });
    expect(getRecord(rec.id)!.provenance).toBeNull();
    await flushOutbox();
    expect(store.has(newKey)).toBe(false);
    reconcile("fake-cal");
    expect(all().filter((r) => r.values.title === "Trip")).toHaveLength(1);
  });

  it("pushes a delete", async () => {
    const rec = createRecord("event", { title: "Cancelled", calendar: "cal-a" }, { actor: "me" });
    await flushOutbox();
    const key = getRecord(rec.id)!.provenance!.key;
    deleteRecord(rec.id, { actor: "me" });
    await flushOutbox();
    expect(store.has(key)).toBe(false);
  });
});

describe("guarding and actions", () => {
  it("keeps a read-only record's source fields, but not its local ones", () => {
    const id = byKey("s2").id;
    expect(() => updateRecord(id, { title: "x" }, { actor: "me" })).toThrow(RecordLockedError);
    expect(() => updateRecord(byKey("s1").id, { response: "accepted" }, { actor: "me" })).toThrow(RecordLockedError);
    expect(() => deleteRecord(id, { actor: "me" })).toThrow(/can't be deleted here/);
    expect(updateRecord(id, { hidden: true }, { actor: "me" }).values.hidden).toBe(true);
  });

  it("runs an action the facts allow", async () => {
    const id = byKey("s2").id;
    expect(withBinding(getRecord(id)!).binding!.actions).toEqual([{ id: "decline", label: "Decline" }]);
    const dto = await runBindingAction(id, "decline");
    expect(calls).toEqual(["rsvp s2"]);
    expect(dto.values.response).toBe("declined");
    await expect(runBindingAction(byKey("s1").id, "decline")).rejects.toThrow(RecordLockedError);
  });
});

describe("publishing bindings", () => {
  it("checks a binding against the running connector", () => {
    const t = getTypeBySlug("event")!;
    expect(() =>
      publish({
        typeId: t.id,
        actor: "test",
        ops: [{ op: "set_binding", binding: { ...t.definition.bindings[0]!, fields: [{ source: "missing", target: "title", mode: "sync" }] } }],
      })
    ).toThrow(PublishError);
    expect(() =>
      publish({ typeId: t.id, actor: "test", ops: [{ op: "set_binding", binding: { ...t.definition.bindings[0]!, connector: "nowhere" } }] })
    ).toThrow(/no connector "nowhere"/);
  });

  it("detaches records when a binding is removed", () => {
    const t = getTypeBySlug("event")!;
    publish({ typeId: t.id, actor: "test", ops: [{ op: "remove_binding", connector: "fake-cal", kind: "event" }] });
    expect(all().every((r) => r.provenance === null)).toBe(true);
    const count = all().length;
    reconcile("fake-cal");
    expect(all()).toHaveLength(count);
  });
});
