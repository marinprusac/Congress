import { describe, expect, it } from "vitest";
import { getPath, interpolate } from "./eventMatching.js";

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

  it("JSON-stringifies an array value rather than comma-joining it", () => {
    expect(interpolate("{{payload.items}}", { items: ["a", "b"] })).toBe('["a","b"]');
    expect(interpolate("{{payload.items}}", { items: [{ x: 1 }] })).toBe('[{"x":1}]');
  });

  it("JSON-stringifies an object value", () => {
    expect(interpolate("{{payload.obj}}", { obj: { a: 1, b: "y" } })).toBe('{"a":1,"b":"y"}');
  });

  it("round-trips an interpolated array/object back through JSON.parse", () => {
    const payload = { items: ["a", "b,c"], obj: { nested: [1, 2] } };
    expect(JSON.parse(interpolate("{{payload.items}}", payload))).toEqual(payload.items);
    expect(JSON.parse(interpolate("{{payload.obj}}", payload))).toEqual(payload.obj);
  });

  it("leaves anything that is not a payload template untouched", () => {
    // No expression language by design: only `payload.`-rooted dotted paths
    // are substituted, and everything else is literal text.
    expect(interpolate("{{name}}", { name: "x" })).toBe("{{name}}");
    expect(interpolate("{{payload.a + payload.b}}", { a: 1, b: 2 })).toBe("{{payload.a + payload.b}}");
    expect(interpolate("100% {{ not a template", {})).toBe("100% {{ not a template");
  });
});
