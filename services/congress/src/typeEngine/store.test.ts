import { readdirSync, existsSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { Operation } from "@congress/shared-types";
import { env } from "../env.js";
import { exhibitsSqlite, runExhibitsMigrations } from "./db/client.js";
import { backupDir } from "./backups.js";
import { getTypeBySlug, listTypes, listVersions, publish, PublishError, reloadTypes, rollback } from "./store.js";

const create: Operation[] = [
  { op: "create_type", slug: "book", label: "Book" },
  { op: "add_field", slug: "title", label: "Title", kind: "text" },
  { op: "set_title_field", field: "title" },
  { op: "add_field", slug: "pages", label: "Pages", kind: "text" },
];

function insert(id: string, title: string, pages: string) {
  exhibitsSqlite
    .prepare(`INSERT INTO x_book (id, created_at, updated_at, title, pages) VALUES (?, 1, 1, ?, ?)`)
    .run(id, title, pages);
}

const rows = () => exhibitsSqlite.prepare("SELECT id, title, pages FROM x_book ORDER BY id").all();
const snapshots = () => (existsSync(backupDir(env.EXHIBITS_DB_PATH)) ? readdirSync(backupDir(env.EXHIBITS_DB_PATH)) : []);

let typeId: string;

beforeAll(() => {
  runExhibitsMigrations();
  const { type } = publish({ ops: create, actor: "test" });
  typeId = type.id;
  insert("a", "Dune", "412");
  insert("b", "Emma", "lots");
});

describe("publish", () => {
  it("creates the table and version 1", () => {
    expect(getTypeBySlug("book")).toMatchObject({ id: typeId, version: 1, origin: "custom" });
    expect(rows()).toHaveLength(2);
    expect(listVersions(typeId)).toEqual([expect.objectContaining({ version: 1, actor: "test" })]);
  });

  it("adds a column without touching rows or taking a snapshot", () => {
    publish({ typeId, ops: [{ op: "add_field", slug: "read", label: "Read", kind: "boolean" }], actor: "test" });
    expect(exhibitsSqlite.prepare("SELECT read FROM x_book WHERE id = 'a'").get()).toEqual({ read: 0 });
    expect(snapshots()).toEqual([]);
  });

  it("rebuilds on a kind change, keeping rows and indexes, with a warning", () => {
    const result = publish({ typeId, ops: [{ op: "change_field_kind", field: "pages", kind: "number" }], actor: "test" });
    expect(result.plan.rebuild).toBe(true);
    expect(result.warnings).toEqual([expect.stringContaining("(1)")]);
    expect(rows()).toEqual([
      { id: "a", title: "Dune", pages: 412 },
      { id: "b", title: "Emma", pages: null },
    ]);
    const indexes = exhibitsSqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'x_book'").all();
    expect(indexes).toEqual(expect.arrayContaining([{ name: "ix_x_book__updated_at" }, { name: "ux_x_book__source" }]));
    expect(snapshots().filter((f) => f.startsWith("exhibits-prepublish-book-"))).toHaveLength(1);
  });

  it("leaves table and version untouched when a blocking check fails", () => {
    insert("c", "dune", "1");
    const before = getTypeBySlug("book")!.version;
    expect(() => publish({ typeId, ops: [{ op: "set_field_options", field: "title", options: { unique: true } }], actor: "test" })).toThrow(
      PublishError
    );
    expect(getTypeBySlug("book")!.version).toBe(before);
    reloadTypes();
    expect(getTypeBySlug("book")!.version).toBe(before);
    expect(listVersions(typeId)).toHaveLength(before);
  });

  it("rejects invalid ops and a clashing slug", () => {
    expect(() => publish({ typeId, ops: [{ op: "retire_field", field: "nope" }], actor: "test" })).toThrow(/no field/);
    expect(() => publish({ ops: create, actor: "test" })).toThrow(/already exists/);
  });

  it("hides hidden types from the default list", () => {
    const { type } = publish({
      ops: [...create.map((o) => (o.op === "create_type" ? { ...o, slug: "secret" } : o)), { op: "set_type_meta", hidden: true }],
      actor: "test",
    });
    expect(type.definition.tableName).toBe("x_secret");
    expect(listTypes().map((t) => t.definition.slug)).not.toContain("secret");
    expect(listTypes({ includeHidden: true }).map((t) => t.definition.slug)).toContain("secret");
  });
});

describe("rollback", () => {
  it("restores an earlier definition and a retired field's data", () => {
    const { type: v } = publish({ typeId, ops: [{ op: "retire_field", field: "read" }], actor: "test" });
    exhibitsSqlite.prepare("UPDATE x_book SET read = 1 WHERE id = 'a'").run();
    expect(v.definition.fields.find((f) => f.slug === "read")?.retired).toBe(true);

    const back = rollback(typeId, 2, "test");
    const read = back.type.definition.fields.find((f) => f.slug === "read")!;
    expect(read.retired).toBe(false);
    expect(back.type.definition.fields.find((f) => f.slug === "pages")?.kind).toBe("text");
    expect(exhibitsSqlite.prepare("SELECT read, pages FROM x_book WHERE id = 'a'").get()).toEqual({ read: 1, pages: "412" });
  });
});
