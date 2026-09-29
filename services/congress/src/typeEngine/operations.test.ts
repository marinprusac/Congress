import { describe, expect, it } from "vitest";
import type { Operation } from "@congress/shared-types";
import { applyOperations, rollbackDefinition } from "./operations.js";

const base: Operation[] = [
  { op: "create_type", slug: "book", label: "Book" },
  { op: "add_field", slug: "title", label: "Title", kind: "text", options: { required: true, searchable: true } },
  { op: "set_title_field", field: "title" },
];

function build(ops: Operation[] = []) {
  return applyOperations(null, [...base, ...ops]);
}

describe("applyOperations", () => {
  it("creates a type with defaults and stable ids", () => {
    const { def, errors } = build();
    expect(errors).toEqual([]);
    expect(def).toMatchObject({ slug: "book", pluralLabel: "Books", tableName: "x_book", eventPrefix: "book", hidden: false });
    expect(def.fields[0]).toMatchObject({ id: "fld_title", column: "title", kind: "text" });
    expect(def.titleField).toBe("fld_title");
  });

  it("is deterministic", () => {
    expect(build()).toEqual(build());
  });

  it("keeps field id and column across renames", () => {
    const { def } = build([{ op: "rename_field", field: "title", slug: "name", label: "Name" }]);
    expect(def.fields[0]).toMatchObject({ id: "fld_title", slug: "name", column: "title", label: "Name" });
  });

  it("gives a re-added slug a fresh column after retiring", () => {
    const { def, errors } = build([
      { op: "add_field", slug: "pages", label: "Pages", kind: "number" },
      { op: "retire_field", field: "pages" },
      { op: "add_field", slug: "pages", label: "Pages", kind: "text" },
    ]);
    expect(errors).toEqual([]);
    const pages = def.fields.filter((f) => f.slug === "pages");
    expect(pages.map((f) => [f.id, f.column, f.retired])).toEqual([
      ["fld_pages", "pages", true],
      ["fld_pages_2", "pages_2", false],
    ]);
  });

  it("refuses to restore a retired field whose slug is taken", () => {
    const { errors } = build([
      { op: "add_field", slug: "pages", label: "Pages", kind: "number" },
      { op: "retire_field", field: "pages" },
      { op: "add_field", slug: "pages", label: "Pages", kind: "text" },
      { op: "restore_field", field: "fld_pages" },
    ]);
    expect(errors[0]).toMatch(/already exists/);
  });

  it("rejects reserved and duplicate slugs", () => {
    expect(build([{ op: "add_field", slug: "id", label: "Id", kind: "text" }]).errors[0]).toMatch(/reserved/);
    expect(build([{ op: "add_field", slug: "title", label: "T", kind: "text" }]).errors[0]).toMatch(/already exists/);
    expect(() => applyOperations(null, [{ op: "create_type", slug: "e", label: "E" }])).toThrow(/reserved/);
  });

  it("requires a title, enum options and relation targets", () => {
    const noTitle = applyOperations(null, [{ op: "create_type", slug: "x", label: "X" }]);
    expect(noTitle.errors).toContain("a title field is required");
    expect(build([{ op: "add_field", slug: "status", label: "Status", kind: "enum" }]).errors).toContain('enum "status" needs options');
    expect(build([{ op: "add_field", slug: "author", label: "Author", kind: "relation" }]).errors).toContain(
      'relation "author" needs a target type'
    );
  });

  it("can't retire the title field and drops layout/actions pointing at retired fields", () => {
    expect(build([{ op: "retire_field", field: "title" }]).errors[0]).toMatch(/title/);
    const { def } = build([
      { op: "add_field", slug: "body", label: "Body", kind: "richtext" },
      { op: "add_field", slug: "read", label: "Read", kind: "boolean" },
      { op: "set_layout", body: "body" },
      { op: "set_actions", actions: [{ kind: "toggle", field: "read", on: "Unread", off: "Read" }] },
      { op: "retire_field", field: "body" },
      { op: "retire_field", field: "read" },
    ]);
    expect(def.layout.body).toBeNull();
    expect(def.actions).toEqual([]);
  });

  it("keeps table names unique across types", () => {
    const { def } = applyOperations(null, base, { takenTables: new Set(["x_book"]) });
    expect(def.tableName).toBe("x_book_2");
  });

  it("gives a to-many relation its own join table", () => {
    const { def } = build([{ op: "add_field", slug: "authors", label: "Authors", kind: "relation", options: { target: "person", many: true } }]);
    expect(def.fields[1]).toMatchObject({ column: "j_book_authors", options: { target: "person", many: true } });
  });

  it("drops options that don't apply to a kind", () => {
    const { def } = build([{ op: "add_field", slug: "done", label: "Done", kind: "boolean", options: { unique: true, searchable: true } }]);
    expect(def.fields[1]!.options).toEqual({});
  });

  it("stores feed rules by field id and checks datetime ops", () => {
    const ok = build([
      { op: "add_field", slug: "due", label: "Due", kind: "datetime" },
      { op: "set_feed_rules", rules: [{ when: { op: "overdue", field: "due" }, score: 90, preview: ["title"] }] },
    ]);
    expect(ok.errors).toEqual([]);
    expect(ok.def.feedRules[0]).toMatchObject({ when: { op: "overdue", field: "fld_due" }, preview: ["fld_title"] });
    const bad = build([{ op: "set_feed_rules", rules: [{ when: { op: "overdue", field: "title" }, score: 90 }] }]);
    expect(bad.errors[0]).toMatch(/datetime/);
  });
});

describe("rollbackDefinition", () => {
  it("restores the target and keeps newer fields retired", () => {
    const v1 = build().def;
    const v2 = applyOperations(v1, [
      { op: "add_field", slug: "pages", label: "Pages", kind: "number" },
      { op: "rename_field", field: "title", label: "Name" },
    ]).def;
    const back = rollbackDefinition(v2, v1);
    expect(back.fields.map((f) => [f.id, f.label, f.retired])).toEqual([
      ["fld_title", "Title", false],
      ["fld_pages", "Pages", true],
    ]);
  });
});
