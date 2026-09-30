import { describe, expect, it } from "vitest";
import { castStored } from "./casts.js";

describe("castStored", () => {
  it("turns anything into text", () => {
    expect(castStored(null, "number", { kind: "text" })).toBe("");
    expect(castStored(1, "boolean", { kind: "text" })).toBe("true");
    expect(castStored(0, "datetime", { kind: "text" })).toBe("1970-01-01T00:00:00.000Z");
    expect(castStored(3.5, "number", { kind: "richtext" })).toBe("3.5");
  });

  it("parses numbers and clears what isn't one", () => {
    expect(castStored(" 42 ", "text", { kind: "number" })).toBe(42);
    expect(castStored("4.6", "text", { kind: "number", integer: true })).toBe(5);
    expect(castStored("many", "text", { kind: "number" })).toBeNull();
    expect(castStored("", "text", { kind: "number" })).toBeNull();
    expect(castStored(1, "boolean", { kind: "number" })).toBe(1);
  });

  it("reads booleans from common words", () => {
    expect(castStored("Yes", "text", { kind: "boolean" })).toBe(1);
    expect(castStored("nope", "text", { kind: "boolean" })).toBe(0);
    expect(castStored(null, "number", { kind: "boolean" })).toBe(0);
    expect(castStored(2, "number", { kind: "boolean" })).toBe(1);
  });

  it("parses dates", () => {
    expect(castStored("2026-09-30T10:00:00Z", "text", { kind: "datetime" })).toBe(Date.parse("2026-09-30T10:00:00Z"));
    expect(castStored("soon", "text", { kind: "datetime" })).toBeNull();
    expect(castStored(1000.4, "number", { kind: "datetime" })).toBe(1000);
  });

  it("matches enum values or labels case-insensitively", () => {
    const options = [{ value: "todo", label: "To do" }, { value: "done", label: "Done" }];
    expect(castStored("TO DO", "text", { kind: "enum", options })).toBe("todo");
    expect(castStored("done", "text", { kind: "enum", options })).toBe("done");
    expect(castStored("later", "text", { kind: "enum", options })).toBeNull();
  });

  it("converts dates and datetimes through the owner's zone", () => {
    // 23:30 UTC on 30 Sep is already 1 Oct in Zagreb.
    expect(castStored(Date.parse("2026-09-30T23:30:00Z"), "datetime", { kind: "date" })).toBe("2026-10-01");
    expect(castStored("2026-10-01", "date", { kind: "datetime" })).toBe(Date.parse("2026-09-30T22:00:00Z"));
    expect(castStored(" 2026-10-01 ", "text", { kind: "date" })).toBe("2026-10-01");
    expect(castStored("someday", "text", { kind: "date" })).toBeNull();
    expect(castStored("2026-10-01", "date", { kind: "text" })).toBe("2026-10-01");
  });
});
