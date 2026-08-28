import { describe, expect, it } from "vitest";
import { getPath, interpolate, priorityAtLeast, priorityLevelForRank, priorityOf, priorityRank } from "./eventMatching.js";

describe("getPath", () => {
  it("reads a top-level key", () => {
    expect(getPath({ taskId: 7 }, "taskId")).toBe(7);
  });

  it("reads a nested dotted path", () => {
    expect(getPath({ a: { b: { c: "deep" } } }, "a.b.c")).toBe("deep");
  });

  it("returns undefined when a segment is missing", () => {
    expect(getPath({ a: {} }, "a.b.c")).toBeUndefined();
    expect(getPath({}, "nope")).toBeUndefined();
  });

  it("returns undefined rather than throwing when a segment is not an object", () => {
    expect(getPath({ a: "string" }, "a.b")).toBeUndefined();
    expect(getPath({ a: 5 }, "a.b")).toBeUndefined();
  });

  it("stops at a null segment instead of throwing", () => {
    expect(getPath({ a: null }, "a.b")).toBeUndefined();
  });

  it("preserves falsy-but-present values", () => {
    expect(getPath({ count: 0 }, "count")).toBe(0);
    expect(getPath({ done: false }, "done")).toBe(false);
    expect(getPath({ note: "" }, "note")).toBe("");
  });
});

describe("interpolate", () => {
  it("substitutes a single payload field", () => {
    expect(interpolate("Task {{payload.name}} is due", { name: "Taxes" })).toBe("Task Taxes is due");
  });

  it("substitutes a nested path", () => {
    expect(interpolate("{{payload.event.summary}}", { event: { summary: "Standup" } })).toBe("Standup");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(interpolate("{{ payload.name }}", { name: "x" })).toBe("x");
  });

  it("renders a missing or null value as the empty string, not 'undefined'", () => {
    expect(interpolate("[{{payload.missing}}]", {})).toBe("[]");
    expect(interpolate("[{{payload.nothing}}]", { nothing: null })).toBe("[]");
  });

  it("stringifies non-string values", () => {
    expect(interpolate("{{payload.n}}/{{payload.b}}", { n: 42, b: true })).toBe("42/true");
  });

  it("substitutes every occurrence, not just the first", () => {
    expect(interpolate("{{payload.a}}-{{payload.a}}", { a: "x" })).toBe("x-x");
  });

  it("leaves anything that is not a payload template untouched", () => {
    // No expression language by design: only `payload.`-rooted dotted paths
    // are substituted, and everything else is literal text.
    expect(interpolate("{{name}}", { name: "x" })).toBe("{{name}}");
    expect(interpolate("{{payload.a + payload.b}}", { a: 1, b: 2 })).toBe("{{payload.a + payload.b}}");
    expect(interpolate("100% {{ not a template", {})).toBe("100% {{ not a template");
  });
});

describe("priorityRank", () => {
  it("orders low < normal < high < urgent", () => {
    const ranks = (["low", "normal", "high", "urgent"] as const).map(priorityRank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(4);
  });

  it("treats an unset level as normal", () => {
    expect(priorityRank(undefined)).toBe(priorityRank("normal"));
  });
});

describe("priorityLevelForRank", () => {
  it("inverts priorityRank", () => {
    for (const level of ["low", "normal", "high", "urgent"] as const) {
      expect(priorityLevelForRank(priorityRank(level))).toBe(level);
    }
  });

  it("falls back to normal for a rank outside the scale", () => {
    expect(priorityLevelForRank(-1)).toBe("normal");
    expect(priorityLevelForRank(99)).toBe("normal");
  });
});

describe("priorityOf", () => {
  it("reads a valid payload.priority", () => {
    expect(priorityOf({ priority: "urgent" })).toBe("urgent");
  });

  it("defaults to normal when absent or unrecognized", () => {
    // payload.priority is a convention, not an enforced field - a publisher
    // that omits it (or sends nonsense) must not have its event rejected.
    expect(priorityOf({})).toBe("normal");
    expect(priorityOf({ priority: "critical" })).toBe("normal");
    expect(priorityOf({ priority: 3 })).toBe("normal");
    expect(priorityOf({ priority: null })).toBe("normal");
  });
});

describe("priorityAtLeast", () => {
  it("is inclusive at the threshold", () => {
    expect(priorityAtLeast("high", "high")).toBe(true);
  });

  it("passes anything above the threshold", () => {
    expect(priorityAtLeast("urgent", "high")).toBe(true);
  });

  it("rejects anything below the threshold", () => {
    expect(priorityAtLeast("normal", "high")).toBe(false);
    expect(priorityAtLeast("low", "normal")).toBe(false);
  });

  it("passes everything when the threshold is the bottom of the scale", () => {
    for (const level of ["low", "normal", "high", "urgent"] as const) {
      expect(priorityAtLeast(level, "low")).toBe(true);
    }
  });
});
