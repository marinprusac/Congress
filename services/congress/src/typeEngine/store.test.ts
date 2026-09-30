import { readdirSync, existsSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { Operation } from "@congress/shared-types";
import { env } from "../env.js";
import { exhibitsSqlite, runExhibitsMigrations } from "./db/client.js";
import { backupDir } from "./backups.js";
import { getTypeBySlug, listTypes, listVersions, previewPublish, previewRollback, publish, PublishError, reloadTypes, rollback } from "./store.js";

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

describe("preview", () => {
  const dbState = () => ({
    version: getTypeBySlug("book")!.version,
    rows: rows(),
    columns: exhibitsSqlite.prepare("SELECT name FROM pragma_table_info('x_book')").all(),
  });

  it("reports the same warning counts as publishing, and writes nothing", () => {
    exhibitsSqlite.prepare("UPDATE x_book SET title = 'x' WHERE id = 'c'").run();
    exhibitsSqlite.prepare("UPDATE x_book SET pages = 'lots' WHERE id = 'b'").run();
    publish({ typeId, ops: [{ op: "change_field_kind", field: "pages", kind: "text" }], actor: "test" });
    const before = dbState();
    const ops: Operation[] = [{ op: "change_field_kind", field: "pages", kind: "number" }, { op: "add_field", slug: "isbn", label: "ISBN", kind: "text" }];
    const preview = previewPublish(typeId, ops);
    expect(preview.errors).toEqual([]);
    expect(preview.plan?.rebuild).toBe(true);
    expect(preview.changes.map((c) => c.text)).toEqual(["Change “Pages” from text to number", 'Add field “ISBN” (text)']);
    expect(dbState()).toEqual(before);

    const published = publish({ typeId, ops, actor: "test" });
    expect(published.warnings).toEqual(preview.warnings.map((w) => `${w.label} (${w.count})`));
    expect(preview.warnings[0]?.count).toBeGreaterThan(0);
  });

  it("reports blockers and op errors without throwing", () => {
    insert("d", "Dune", "1");
    expect(previewPublish(typeId, [{ op: "set_field_options", field: "title", options: { unique: true } }]).blockers).toEqual([
      expect.objectContaining({ count: 1 }),
    ]);
    expect(previewPublish(typeId, [{ op: "retire_field", field: "nope" }]).errors).toEqual([expect.stringMatching(/no field/)]);
    expect(previewPublish(undefined, [{ op: "add_field", slug: "x", label: "X", kind: "text" }]).errors).toHaveLength(1);
  });

  it("previews a rollback as a diff", () => {
    const preview = previewRollback(typeId, 1);
    expect(preview.errors).toEqual([]);
    expect(preview.changes.some((c) => c.text.startsWith("Retire"))).toBe(true);
    expect(previewRollback(typeId, 999).errors).toHaveLength(1);
  });

  it("lists versions with their changes, newest first", () => {
    const versions = listVersions(typeId);
    expect(versions[0]!.version).toBe(getTypeBySlug("book")!.version);
    expect(versions.at(-1)!.changes[0]).toEqual({ area: "type", text: "Create type “Book” (Books)" });
  });
});

describe("relations", () => {
  const typeOps = (slug: string, extra: Operation[] = []): Operation[] => [
    { op: "create_type", slug, label: slug },
    { op: "add_field", slug: "name", label: "Name", kind: "text" },
    { op: "set_title_field", field: "name" },
    ...extra,
  ];

  it("needs an existing target, or the type itself", () => {
    const toFilm: Operation = { op: "add_field", slug: "of", label: "Of", kind: "relation", options: { target: "film" } };
    expect(() => publish({ actor: "test", ops: typeOps("review", [toFilm]) })).toThrow(/no type "film"/);
    const { type } = publish({
      actor: "test",
      ops: typeOps("review", [
        { op: "add_field", slug: "of", label: "Of", kind: "relation", options: { target: "book" } },
        { op: "add_field", slug: "replies", label: "Replies", kind: "relation", options: { target: "review", many: true } },
      ]),
    });
    expect(type.version).toBe(1);
  });

  it("keeps a relation's target fixed", () => {
    const review = getTypeBySlug("review")!;
    const retarget: Operation = { op: "set_field_options", field: "of", options: { target: "review" } };
    expect(() => publish({ typeId: review.id, actor: "test", ops: [retarget] })).toThrow(/target type can't change/);
  });

  it("refuses renaming a linked-to type's slug, but not its label", () => {
    const book = getTypeBySlug("book")!;
    expect(() => publish({ typeId: book.id, actor: "test", ops: [{ op: "set_type_meta", slug: "novel" }] })).toThrow(/review\.of/);
    expect(publish({ typeId: book.id, actor: "test", ops: [{ op: "set_type_meta", label: "Novel" }] }).type.definition.slug).toBe("book");
  });
});
