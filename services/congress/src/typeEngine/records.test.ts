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
  relatedRecords,
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
  for (const slug of ["person", "shelf"]) {
    publish({
      actor: "test",
      ops: [
        { op: "create_type", slug, label: slug },
        { op: "add_field", slug: "name", label: "Name", kind: "text" },
        { op: "set_title_field", field: "name" },
      ],
    });
  }
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
    const person = createRecord("person", { name: "George Eliot" }).id;
    const [a, b] = [createRecord("shelf", { name: "A" }).id, createRecord("shelf", { name: "B" }).id].sort();
    const rec = createRecord("book", {
      title: "Middlemarch",
      notes: "see [[exhibit:tasks:task-3|Read it]]",
      author: person,
      shelves: [b, a],
    });
    expect(getRecord(rec.id)!.values.shelves).toEqual([b, a]);
    addManualRef(rec.id, "note-9");
    expect(refsFrom(rec.id)).toEqual(
      [
        ["note-9", true],
        [person, false],
        [a, false],
        [b, false],
        ["task-3", false],
      ].sort()
    );
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

describe("relations", () => {
  it("refuses ids that aren't records of the target type", () => {
    const shelf = createRecord("shelf", { name: "Top" }).id;
    const issues = (fn: () => unknown) => {
      try {
        fn();
      } catch (err) {
        return ((err as RecordValidationError).issues as { fieldErrors: Record<string, string[]> }).fieldErrors;
      }
      throw new Error("expected a validation error");
    };
    expect(issues(() => createRecord("book", { title: "Wrong", author: shelf }))).toEqual({ author: [expect.stringContaining(shelf)] });
    expect(issues(() => createRecord("book", { title: "Missing", shelves: [shelf, "nope"] }))).toEqual({ shelves: [expect.stringContaining("nope")] });
    const book = createRecord("book", { title: "Right", shelves: [shelf] });
    expect(() => updateRecord(book.id, { author: "nope" })).toThrow(RecordValidationError);
  });

  it("clears links to a deleted record, in both storage forms, and re-syncs without events", () => {
    const person = createRecord("person", { name: "Jane Austen" }).id;
    const shelf = createRecord("shelf", { name: "Classics" }).id;
    const other = createRecord("shelf", { name: "Favourites" }).id;
    const emma = createRecord("book", { title: "Persuasion", author: person, shelves: [shelf, other] });
    expect(relatedRecords(person)).toEqual([
      { type: "book", typeLabel: "Books", field: "author", fieldLabel: "Author", total: 1, records: [{ id: emma.id, name: "Persuasion", url: `/${emma.id}` }] },
    ]);

    events.length = 0;
    deleteRecord(person);
    deleteRecord(shelf);
    expect(getRecord(emma.id)!.values).toMatchObject({ author: null, shelves: [other] });
    expect(refsFrom(emma.id).map(([t]) => t)).toEqual([other]);
    expect(events.map((e) => e.type)).toEqual(["person.deleted", "shelf.deleted"]);
  });

  it("groups reverse relations newest first and caps each group", () => {
    const shelf = createRecord("shelf", { name: "Big" }).id;
    for (let i = 0; i < 22; i++) createRecord("book", { title: `Vol ${i}`, shelves: [shelf] });
    const [group] = relatedRecords(shelf)!;
    expect(group).toMatchObject({ field: "shelves", total: 22 });
    expect(group!.records).toHaveLength(20);
    expect(group!.records[0]!.name).toBe("Vol 21");
    expect(relatedRecords("missing")).toBeNull();
  });
});

stop;
