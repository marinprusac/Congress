import { describe, expect, it } from "vitest";
import type { Operation, TypeDefinition } from "@congress/shared-types";
import { applyOperations } from "./operations.js";
import { planMigration } from "./planner.js";
import { quoteIdent } from "./ddl.js";

const base: Operation[] = [
  { op: "create_type", slug: "book", label: "Book" },
  { op: "add_field", slug: "title", label: "Title", kind: "text" },
  { op: "set_title_field", field: "title" },
  { op: "add_field", slug: "pages", label: "Pages", kind: "text" },
];

const v1 = applyOperations(null, base).def;
const next = (ops: Operation[], from: TypeDefinition = v1) => {
  const r = applyOperations(from, ops);
  expect(r.errors).toEqual([]);
  return r.def;
};

describe("planMigration", () => {
  it("creates the table with system columns and indexes", () => {
    const plan = planMigration(null, v1);
    expect(plan.steps[0]).toBe(
      `CREATE TABLE "x_book" ("id" TEXT PRIMARY KEY NOT NULL, "created_at" INTEGER NOT NULL, "updated_at" INTEGER NOT NULL, "source_binding" TEXT, "source_key" TEXT, "title" TEXT NOT NULL DEFAULT '', "pages" TEXT NOT NULL DEFAULT '')`
    );
    expect(plan.steps.some((s) => s.includes('"ix_x_book__updated_at"'))).toBe(true);
    expect(plan.steps.some((s) => s.includes('"ux_x_book__source"'))).toBe(true);
    expect(plan.rebuild).toBe(false);
  });

  it("adds a column per new field with the right default", () => {
    const plan = planMigration(
      v1,
      next([
        { op: "add_field", slug: "read", label: "Read", kind: "boolean" },
        { op: "add_field", slug: "finished", label: "Finished", kind: "datetime", options: { indexed: true } },
      ])
    );
    expect(plan.steps).toEqual([
      `ALTER TABLE "x_book" ADD COLUMN "read" INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE "x_book" ADD COLUMN "finished" INTEGER`,
      `CREATE INDEX "ix_x_book__finished" ON "x_book" ("finished")`,
    ]);
  });

  it("costs nothing for renames, retires and layout", () => {
    const plan = planMigration(
      v1,
      next([
        { op: "rename_field", field: "pages", slug: "page_count", label: "Page count" },
        { op: "retire_field", field: "page_count" },
        { op: "set_type_meta", label: "Volume", icon: "book" },
      ])
    );
    expect(plan.steps).toEqual([]);
  });

  it("rebuilds with te_cast and warns on a lossy kind change", () => {
    const plan = planMigration(v1, next([{ op: "change_field_kind", field: "pages", kind: "number", options: { integer: true } }]));
    expect(plan.rebuild).toBe(true);
    expect(plan.steps[0]).toContain(`CREATE TABLE "x_book__new"`);
    expect(plan.steps[1]).toContain(`te_cast("pages", 'text', '{"kind":"number","integer":true}')`);
    expect(plan.steps.slice(2, 4)).toEqual([`DROP TABLE "x_book"`, `ALTER TABLE "x_book__new" RENAME TO "x_book"`]);
    expect(plan.preflight).toEqual([expect.objectContaining({ block: false, label: expect.stringContaining("pages") })]);
  });

  it("checks for duplicates before making a field unique", () => {
    const plan = planMigration(v1, next([{ op: "set_field_options", field: "title", options: { unique: true } }]));
    expect(plan.preflight).toEqual([expect.objectContaining({ block: true })]);
    expect(plan.steps).toEqual([
      `CREATE UNIQUE INDEX "ux_x_book__title" ON "x_book" ("title" COLLATE NOCASE) WHERE "title" <> ''`,
    ]);
  });

  it("drops the unique index when uniqueness is turned off", () => {
    const unique = next([{ op: "set_field_options", field: "title", options: { unique: true } }]);
    const plan = planMigration(unique, next([{ op: "set_field_options", field: "title", options: { unique: false } }], unique));
    expect(plan.steps).toEqual([`DROP INDEX IF EXISTS "ux_x_book__title"`]);
    expect(plan.preflight).toEqual([]);
  });

  it("warns when enum options still in use are removed", () => {
    const withEnum = next([
      { op: "add_field", slug: "status", label: "Status", kind: "enum", options: { options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] } },
    ]);
    const plan = planMigration(
      withEnum,
      next([{ op: "set_field_options", field: "status", options: { options: [{ value: "a", label: "A" }] } }], withEnum)
    );
    expect(plan.steps).toEqual([]);
    expect(plan.preflight[0]).toMatchObject({ block: false, sql: expect.stringContaining(`IN ('b')`) });
  });

  it("creates a join table for a to-many relation", () => {
    const plan = planMigration(v1, next([{ op: "add_field", slug: "authors", label: "Authors", kind: "relation", options: { target: "person", many: true } }]));
    expect(plan.steps[0]).toContain(`CREATE TABLE "j_book_authors"`);
    expect(plan.steps[1]).toContain(`"ix_j_book_authors__to"`);
  });

  it("refuses to move a type's table", () => {
    expect(() => planMigration(v1, { ...v1, tableName: "x_other" })).toThrow();
  });
});

describe("quoteIdent", () => {
  it("accepts engine names and rejects anything else", () => {
    expect(quoteIdent("x_book")).toBe(`"x_book"`);
    for (const bad of [`x"; DROP TABLE types; --`, "X", "1abc", "", "a b", "a-b"]) {
      expect(() => quoteIdent(bad)).toThrow();
    }
  });
});
