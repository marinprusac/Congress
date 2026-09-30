import { describe, expect, it } from "vitest";
import type { Operation, TypeDefinition } from "@congress/shared-types";
import { applyOperations } from "./operations.js";
import { diffDefinitions } from "./diff.js";
import { TASK } from "./premade/task.js";

function build(ops: Operation[], start: TypeDefinition | null = null): TypeDefinition {
  const { def, errors } = applyOperations(start, ops);
  expect(errors).toEqual([]);
  return def;
}

const texts = (before: TypeDefinition | null, after: TypeDefinition) => diffDefinitions(before, after).map((c) => c.text);

const book = build([
  { op: "create_type", slug: "book", label: "Book" },
  { op: "add_field", slug: "title", label: "Title", kind: "text", options: { required: true } },
  { op: "set_title_field", field: "title" },
  { op: "add_field", slug: "rating", label: "Rating", kind: "text" },
  { op: "add_field", slug: "genre", label: "Genre", kind: "enum", options: { options: [{ value: "sf", label: "SF" }] } },
  { op: "add_field", slug: "notes", label: "Notes", kind: "text" },
]);

describe("diffDefinitions", () => {
  it("describes a new type field by field", () => {
    expect(texts(null, book)).toEqual([
      "Create type “Book” (Books)",
      "Add field “Title” (text, required)",
      "Add field “Rating” (text)",
      "Add field “Genre” (enum, SF)",
      "Add field “Notes” (text)",
      "Title field: “Title”",
    ]);
  });

  it("describes renames, kind changes, options, retires and reorders", () => {
    const after = build(
      [
        { op: "rename_field", field: "rating", slug: "score", label: "Score" },
        { op: "change_field_kind", field: "score", kind: "number", options: { integer: true } },
        { op: "set_field_options", field: "genre", options: { options: [{ value: "fantasy", label: "Fantasy" }] } },
        { op: "retire_field", field: "notes" },
        { op: "reorder_fields", order: ["genre", "title", "score"] },
        { op: "set_type_meta", hidden: true, label: "Novel" },
      ],
      book
    );
    expect(texts(book, after)).toEqual([
      "Rename type “Book” (Books) → “Novel” (Books)",
      "Hide type",
      "“Genre”: +option Fantasy, −option SF",
      "Rename “Rating” (rating) → “Score” (score)",
      "Change “Score” from text to number",
      "“Score”: integer on",
      "Retire “Notes”",
      "Reorder fields",
    ]);
  });

  it("describes actions, feed rules and time triggers in words", () => {
    const task = TASK.batches.reduce<TypeDefinition | null>((def, ops) => build(ops, def), null)!;
    const lines = diffDefinitions(null, task).filter((c) => c.area !== "fields" && c.area !== "type" && c.area !== "layout");
    expect(lines.map((c) => c.text)).toEqual([
      "Action: Complete/Reopen toggles completed (on → completed, off → reopened), stamps completed_at",
      "Feed rule: due overdue and completed = false → score 90 “Overdue”",
      "Feed rule: due within 48h and completed = false → score 85",
      "Time trigger: due (end of day) and completed = false: due_soon 1d before, overdue at the time; clears with due_cleared",
    ]);
    expect(diffDefinitions(task, task)).toEqual([]);
  });
});
