import { describe, expect, it } from "vitest";
import { answerSchemaFor, askFieldsSchema, type AskFieldInput } from "./aiAsks.js";

const fields: AskFieldInput[] = [
  { key: "when", label: "When", type: "date", required: true },
  { key: "mood", label: "Mood", type: "choice", options: [{ value: "good", label: "Good" }, { value: "meh", label: "Meh" }] },
  { key: "hours", label: "Hours", type: "number", min: 0, max: 24 },
  { key: "done", label: "Done?", type: "boolean", required: true },
  { key: "tags", label: "Tags", type: "multichoice", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
  { key: "note", label: "Note", type: "exhibit" },
];

describe("askFieldsSchema", () => {
  it("accepts a well-formed form and rejects duplicate keys and bad ranges", () => {
    expect(askFieldsSchema.safeParse(fields).success).toBe(true);
    const dup = askFieldsSchema.safeParse([fields[0], { ...fields[0] }]);
    expect(dup.success).toBe(false);
    expect(dup.error?.issues[0]?.message).toMatch(/duplicate key/);
    expect(askFieldsSchema.safeParse([{ key: "n", label: "N", type: "number", min: 5, max: 1 }]).success).toBe(false);
    expect(askFieldsSchema.safeParse([{ key: "c", label: "C", type: "choice", options: [{ value: "x", label: "X" }] }]).success).toBe(false);
    expect(askFieldsSchema.safeParse([]).success).toBe(false);
  });
});

describe("answerSchemaFor", () => {
  const schema = answerSchemaFor(askFieldsSchema.parse(fields));

  it("accepts valid answers and nulls out empty optional ones", () => {
    const r = schema.safeParse({ when: "2026-09-28", mood: "", hours: 3, done: false, tags: [], note: "[[exhibit:notes:note-1|X]]" });
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ when: "2026-09-28", mood: null, hours: 3, done: false, tags: null, note: "[[exhibit:notes:note-1|X]]" });
  });

  it("rejects missing required, out-of-range, unknown option and unknown keys", () => {
    const r = schema.safeParse({ when: "", mood: "great", hours: 30, done: true, tags: ["z"], extra: 1 });
    expect(r.success).toBe(false);
    const paths = r.error?.issues.map((i) => i.path[0] ?? i.code);
    expect(paths).toEqual(expect.arrayContaining(["when", "mood", "hours", "tags", "unrecognized_keys"]));
  });
});
