import { describe, expect, it } from "vitest";
import type { Operation } from "@congress/shared-types";
import { applyOperations } from "./operations.js";
import { decodeValue, encodeValue, recordInputSchema } from "./codec.js";

const def = applyOperations(null, [
  { op: "create_type", slug: "task", label: "Task" },
  { op: "add_field", slug: "title", label: "Title", kind: "text", options: { required: true } },
  { op: "set_title_field", field: "title" },
  { op: "add_field", slug: "due", label: "Due", kind: "datetime" },
  { op: "add_field", slug: "done", label: "Done", kind: "boolean" },
  { op: "add_field", slug: "points", label: "Points", kind: "number", options: { integer: true } },
  { op: "add_field", slug: "status", label: "Status", kind: "enum", options: { options: [{ value: "todo", label: "To do" }] } },
  { op: "add_field", slug: "tags", label: "Tags", kind: "relation", options: { target: "tag", many: true } },
] satisfies Operation[]).def;

const field = (slug: string) => def.fields.find((f) => f.slug === slug)!;

describe("encode/decode", () => {
  it("round-trips every kind", () => {
    const due = "2026-09-30T10:00:00.000Z";
    expect(decodeValue(field("due"), encodeValue(field("due"), due))).toBe(due);
    expect(decodeValue(field("done"), encodeValue(field("done"), true))).toBe(true);
    expect(decodeValue(field("points"), encodeValue(field("points"), 3))).toBe(3);
    expect(decodeValue(field("status"), encodeValue(field("status"), "todo"))).toBe("todo");
    expect(decodeValue(field("title"), null)).toBe("");
    expect(decodeValue(field("due"), null)).toBeNull();
  });
});

describe("recordInputSchema", () => {
  it("requires required fields on create only", () => {
    expect(recordInputSchema(def, "create").safeParse({}).success).toBe(false);
    expect(recordInputSchema(def, "create").safeParse({ title: "  " }).success).toBe(false);
    expect(recordInputSchema(def, "create").safeParse({ title: "Buy milk" }).success).toBe(true);
    expect(recordInputSchema(def, "patch").safeParse({ done: true }).success).toBe(true);
    expect(recordInputSchema(def, "patch").safeParse({ title: "" }).success).toBe(false);
  });

  it("validates kinds, enum values and unknown fields", () => {
    const patch = recordInputSchema(def, "patch");
    expect(patch.safeParse({ due: "not a date" }).success).toBe(false);
    expect(patch.safeParse({ points: 1.5 }).success).toBe(false);
    expect(patch.safeParse({ status: "later" }).success).toBe(false);
    expect(patch.safeParse({ tags: ["a", "b"] }).success).toBe(true);
    expect(patch.safeParse({ nope: 1 }).success).toBe(false);
    expect(patch.safeParse({ due: null, status: null, points: null }).success).toBe(true);
  });
});

describe("date and readonly fields", () => {
  const withDate = applyOperations(def, [
    { op: "add_field", slug: "day", label: "Day", kind: "date" },
    { op: "add_field", slug: "closed_at", label: "Closed at", kind: "datetime", options: { readonly: true } },
  ]).def;
  const day = withDate.fields.find((f) => f.slug === "day")!;

  it("keeps dates as YYYY-MM-DD and reads a timestamp as its day in the owner's zone", () => {
    expect(encodeValue(day, "2026-10-01")).toBe("2026-10-01");
    expect(encodeValue(day, "2026-09-30T23:30:00Z")).toBe("2026-10-01");
    expect(decodeValue(day, "2026-10-01")).toBe("2026-10-01");
    const patch = recordInputSchema(withDate, "patch");
    expect(patch.safeParse({ day: "2026-02-30" }).success).toBe(false);
    expect(patch.safeParse({ day: "tomorrow" }).success).toBe(false);
    expect(patch.safeParse({ day: null }).success).toBe(true);
  });

  it("leaves readonly fields out of input unless trusted", () => {
    expect(recordInputSchema(withDate, "patch").safeParse({ closed_at: "2026-09-30T10:00:00Z" }).success).toBe(false);
    expect(recordInputSchema(withDate, "patch", { includeReadonly: true }).safeParse({ closed_at: "2026-09-30T10:00:00Z" }).success).toBe(true);
  });
});
