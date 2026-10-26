import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrationsDir } from "@congress/test-support";
import { db, runMigrations } from "../db/client.js";
import { exhibitCache } from "../db/schema.js";
import { recordsSqlite, runRecordsMigrations } from "./db/client.js";
import { publish } from "./store.js";
import { createRecord, getRecord } from "./records.js";
import { backfillTitlePrefixes } from "./titleBackfill.js";

beforeAll(() => {
  runMigrations(migrationsDir("congress"));
  runRecordsMigrations();
  publish({
    actor: "test",
    ops: [
      { op: "create_type", slug: "note", label: "Note" },
      { op: "add_field", slug: "title", label: "Title", kind: "text" },
      { op: "set_title_field", field: "title" },
    ],
  });
});

describe("backfillTitlePrefixes", () => {
  it("prefixes owner-authored titles once and leaves source rows, prefixed rows and timestamps alone", () => {
    const bare = createRecord("note", { title: "Groceries" });
    const done = createRecord("note", { title: "Note: Done" });
    const synced = createRecord("note", { title: "From upstream" });
    recordsSqlite.prepare(`UPDATE "x_note" SET "source_binding" = 'b', "source_key" = 'k' WHERE "id" = ?`).run(synced.id);
    recordsSqlite.prepare(`UPDATE "x_note" SET "updated_at" = 1000 WHERE "id" = ?`).run(bare.id);

    expect(backfillTitlePrefixes()).toBe(1);
    expect(getRecord(bare.id)).toMatchObject({ values: { title: "Note: Groceries" }, updatedAt: new Date(1000).toISOString() });
    expect(getRecord(done.id)?.values.title).toBe("Note: Done");
    expect(getRecord(synced.id)?.values.title).toBe("From upstream");
    expect(db.select().from(exhibitCache).where(eq(exhibitCache.id, bare.id)).get()?.name).toBe("Note: Groceries");

    // A bare title written afterwards is not touched again: the pass runs once.
    const later = createRecord("note", { title: "Later" });
    expect(backfillTitlePrefixes()).toBe(0);
    expect(getRecord(later.id)?.values.title).toBe("Later");
  });
});
