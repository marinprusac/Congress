import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { migrationsDir } from "@congress/test-support";
import { db, runMigrations } from "../db/client.js";
import { exhibitCache, exhibitRefs } from "../db/schema.js";
import { onEventPublished, type PublishedEvent } from "../events.js";
import { runExhibitsMigrations } from "./db/client.js";
import { publish } from "./store.js";
import {
  addManualRef,
  createRecord,
  deleteRecord,
  getRecord,
  listRecords,
  RecordConflictError,
  RecordValidationError,
  removeManualRef,
  updateRecord,
} from "./records.js";

const events: PublishedEvent[] = [];
const stop = onEventPublished((e) => events.push(e));

beforeAll(() => {
  runMigrations(migrationsDir("congress"));
  runExhibitsMigrations();
  publish({
    actor: "test",
    ops: [
      { op: "create_type", slug: "book", label: "Book" },
      { op: "add_field", slug: "title", label: "Title", kind: "text", options: { required: true, unique: true, searchable: true } },
      { op: "set_title_field", field: "title" },
      { op: "add_field", slug: "notes", label: "Notes", kind: "richtext" },
      { op: "add_field", slug: "read", label: "Read", kind: "boolean" },
      { op: "add_field", slug: "author", label: "Author", kind: "relation", options: { target: "person" } },
      { op: "add_field", slug: "shelves", label: "Shelves", kind: "relation", options: { target: "shelf", many: true } },
    ],
  });
});

afterEach(() => {
  events.length = 0;
});

const cacheRow = (id: string) => db.select().from(exhibitCache).where(eq(exhibitCache.id, id)).get();
const refsFrom = (id: string) =>
  db
    .select()
    .from(exhibitRefs)
    .where(eq(exhibitRefs.sourceId, id))
    .all()
    .map((r) => [r.targetId, r.isManual])
    .sort();

describe("records", () => {
  it("creates with defaults, caches the exhibit and publishes an event", () => {
    const rec = createRecord("book", { title: "Dune" }, { actor: "me" });
    expect(rec).toMatchObject({ type: "book", typeVersion: 1, values: { title: "Dune", notes: "", read: false, author: null, shelves: [] } });
    expect(rec.id).toMatch(/^[0-9a-z]{26}$/);
    expect(cacheRow(rec.id)).toMatchObject({ chamber: "e", type: "book", name: "Dune", url: `/${rec.id}`, deleted: false });
    expect(events).toEqual([
      expect.objectContaining({
        chamber: "types",
        type: "book.created",
        actor: "me",
        payload: { recordId: rec.id, type: "book", title: "Dune", url: `/e/${rec.id}` },
      }),
    ]);
  });

  it("patches only the given fields", () => {
    const rec = createRecord("book", { title: "Emma", notes: "keep me" });
    const next = updateRecord(rec.id, { read: true });
    expect(next.values).toMatchObject({ title: "Emma", notes: "keep me", read: true });
    expect(events.at(-1)).toMatchObject({ type: "book.updated", payload: { changed: ["read"] } });
  });

  it("validates input and maps unique conflicts to the field (case-insensitive)", () => {
    createRecord("book", { title: "Ulysses" });
    expect(() => createRecord("book", {})).toThrow(RecordValidationError);
    expect(() => createRecord("book", { title: "ulysses" })).toThrow(RecordConflictError);
    try {
      createRecord("book", { title: "ULYSSES" });
    } catch (err) {
      expect((err as RecordConflictError).field).toBe("title");
    }
  });

  it("syncs outgoing refs from richtext tokens, relations and manual refs", () => {
    const rec = createRecord("book", {
      title: "Middlemarch",
      notes: "see [[exhibit:tasks:task-3|Read it]]",
      author: "person-id",
      shelves: ["shelf-a", "shelf-b"],
    });
    expect(getRecord(rec.id)!.values.shelves).toEqual(["shelf-a", "shelf-b"]);
    addManualRef(rec.id, "note-9");
    expect(refsFrom(rec.id)).toEqual([
      ["note-9", true],
      ["person-id", false],
      ["shelf-a", false],
      ["shelf-b", false],
      ["task-3", false],
    ]);
    removeManualRef(rec.id, "note-9");
    expect(refsFrom(rec.id).map(([t]) => t)).not.toContain("note-9");
  });

  it("deletes the record and marks the cache row deleted", () => {
    const rec = createRecord("book", { title: "Gone Girl" });
    addManualRef(rec.id, "note-1");
    deleteRecord(rec.id);
    expect(getRecord(rec.id)).toBeNull();
    expect(cacheRow(rec.id)).toMatchObject({ deleted: true });
    expect(events.at(-1)).toMatchObject({ type: "book.deleted", payload: { recordId: rec.id } });
  });

  it("lists newest first", () => {
    const titles = listRecords("book").map((r) => r.values.title);
    expect(titles[0]).toBe("Middlemarch");
  });
});

stop;
