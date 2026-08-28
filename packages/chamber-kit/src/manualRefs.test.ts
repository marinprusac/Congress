import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { createDb } from "./db.js";
import { createManualRefs, createManualRefsByExhibitId, type ManualRefsByIdApi } from "./manualRefs.js";

// Mirrors services/chamber-notes/src/db/schema.ts's noteRefs shape - the
// unique index on (ownerId, targetExhibitId) is load-bearing, since
// addManualRef relies on a real conflict target for .onConflictDoNothing().
const refs = sqliteTable(
  "refs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: integer("owner_id").notNull(),
    targetExhibitId: text("target_exhibit_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("refs_owner_target_idx").on(table.ownerId, table.targetExhibitId)]
);

const { db, closeDb } = createDb(join(mkdtempSync(join(tmpdir(), "congress-manualrefs-")), "refs.sqlite3"), { refs });

const api = createManualRefs<number>({
  db,
  table: refs,
  ownerColumn: refs.ownerId,
  ownerKey: "ownerId",
  targetColumn: refs.targetExhibitId,
});

beforeEach(() => {
  db.run(sql`drop table if exists refs`);
  db.run(
    sql`create table refs (id integer primary key autoincrement, owner_id integer not null, target_exhibit_id text not null, created_at integer not null)`
  );
  db.run(sql`create unique index refs_owner_target_idx on refs (owner_id, target_exhibit_id)`);
});

afterAll(() => closeDb());

describe("createManualRefs", () => {
  it("returns an empty list for an owner with no rows", () => {
    expect(api.listManualRefs(1)).toEqual([]);
  });

  it("addManualRef inserts a row that listManualRefs reflects", () => {
    api.addManualRef(1, "note-2");
    expect(api.listManualRefs(1)).toEqual(["note-2"]);
  });

  it("addManualRef called twice with the same (owner, target) is a silent no-op, not a duplicate row", () => {
    api.addManualRef(1, "note-2");
    api.addManualRef(1, "note-2");
    expect(db.select().from(refs).all()).toHaveLength(1);
    expect(api.listManualRefs(1)).toEqual(["note-2"]);
  });

  it("two different owners against the same target don't collide", () => {
    api.addManualRef(1, "note-2");
    api.addManualRef(2, "note-2");
    expect(api.listManualRefs(1)).toEqual(["note-2"]);
    expect(api.listManualRefs(2)).toEqual(["note-2"]);
    expect(db.select().from(refs).all()).toHaveLength(2);
  });

  it("removeManualRef deletes exactly the matching row, leaving the owner's other refs untouched", () => {
    api.addManualRef(1, "note-2");
    api.addManualRef(1, "note-3");
    api.removeManualRef(1, "note-2");
    expect(api.listManualRefs(1)).toEqual(["note-3"]);
  });

  it("removeManualRef for a ref that was never added is a silent no-op", () => {
    expect(() => api.removeManualRef(1, "note-9")).not.toThrow();
    expect(api.listManualRefs(1)).toEqual([]);
  });

  it("deleteManualRefsForOwner clears one owner's refs and leaves another owner's untouched", () => {
    api.addManualRef(1, "note-2");
    api.addManualRef(2, "note-2");
    api.deleteManualRefsForOwner(1);
    expect(api.listManualRefs(1)).toEqual([]);
    expect(api.listManualRefs(2)).toEqual(["note-2"]);
  });
});

describe("createManualRefsByExhibitId", () => {
  function build() {
    const inner: ManualRefsByIdApi<number> = {
      listManualRefs: vi.fn().mockReturnValue(["note-2"]),
      addManualRef: vi.fn(),
      removeManualRef: vi.fn(),
    };
    const parseId = (exhibitId: string): number | null => {
      if (!exhibitId.startsWith("task-")) return null;
      const id = Number(exhibitId.slice(5));
      return Number.isInteger(id) ? id : null;
    };
    return { inner, wrapped: createManualRefsByExhibitId(inner, parseId) };
  }

  it("listManualRefsByExhibitId returns null for an unparseable id without calling through", () => {
    const { inner, wrapped } = build();
    expect(wrapped.listManualRefsByExhibitId("note-2")).toBeNull();
    expect(inner.listManualRefs).not.toHaveBeenCalled();
  });

  it("listManualRefsByExhibitId delegates and returns the result for a parseable id", () => {
    const { inner, wrapped } = build();
    expect(wrapped.listManualRefsByExhibitId("task-5")).toEqual(["note-2"]);
    expect(inner.listManualRefs).toHaveBeenCalledWith(5);
  });

  it("addManualRefByExhibitId returns false without calling through for an unparseable id", () => {
    const { inner, wrapped } = build();
    expect(wrapped.addManualRefByExhibitId("note-2", "note-9")).toBe(false);
    expect(inner.addManualRef).not.toHaveBeenCalled();
  });

  it("addManualRefByExhibitId calls through and returns true for a parseable id", () => {
    const { inner, wrapped } = build();
    expect(wrapped.addManualRefByExhibitId("task-5", "note-9")).toBe(true);
    expect(inner.addManualRef).toHaveBeenCalledWith(5, "note-9");
  });

  it("removeManualRefByExhibitId returns false without calling through for an unparseable id", () => {
    const { inner, wrapped } = build();
    expect(wrapped.removeManualRefByExhibitId("note-2", "note-9")).toBe(false);
    expect(inner.removeManualRef).not.toHaveBeenCalled();
  });

  it("removeManualRefByExhibitId calls through and returns true for a parseable id", () => {
    const { inner, wrapped } = build();
    expect(wrapped.removeManualRefByExhibitId("task-5", "note-9")).toBe(true);
    expect(inner.removeManualRef).toHaveBeenCalledWith(5, "note-9");
  });
});
