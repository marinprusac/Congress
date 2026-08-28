import { describe, expect, it, vi } from "vitest";
import { createTableBackedExhibits } from "./exhibits.js";

interface Row {
  id: number;
  title: string;
}

// The factory takes its row queries as callbacks, so the whole contract that
// notes/documents/tasks/automation/map share can be exercised with plain
// arrays and no database at all.
function build(rows: Row[] = [], overrides: Partial<Parameters<typeof createTableBackedExhibits<Row>>[0]> = {}) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return createTableBackedExhibits<Row>({
    idPrefix: "note-",
    type: "note",
    urlFor: (id) => `/n/${id}`,
    searchRows: (pattern, limit) =>
      rows
        .filter((r) => r.title.toLowerCase().includes(pattern.replaceAll("%", "").toLowerCase()))
        .slice(0, limit),
    resolveRows: (ids) => ids.map((id) => byId.get(id)).filter((r): r is Row => r !== undefined),
    ...overrides,
  });
}

describe("parseId", () => {
  const { parseId } = build();

  it("parses a well-formed id", () => {
    expect(parseId("note-42")).toBe(42);
  });

  it("returns null for another chamber's prefix", () => {
    expect(parseId("task-42")).toBeNull();
    expect(parseId("42")).toBeNull();
  });

  it("returns null for a non-integer suffix", () => {
    expect(parseId("note-1.5")).toBeNull();
    expect(parseId("note-abc")).toBeNull();
  });

  // The two documented consequences of parsing with Number(): an empty
  // suffix is 0 and a hex literal is accepted. Neither is reachable from an
  // id this codebase generates (toExhibitId only ever emits decimal row
  // ids), so they are pinned as known behaviour rather than fixed - the
  // point of the test is that a change here becomes visible.
  it("accepts what Number() accepts: an empty suffix is 0, hex is parsed", () => {
    expect(parseId("note-")).toBe(0);
    expect(parseId("note-0x10")).toBe(16);
  });

  it("round-trips with toExhibitId", () => {
    const { toExhibitId } = build();
    expect(parseId(toExhibitId(7))).toBe(7);
  });
});

describe("search", () => {
  it("maps rows to exhibit results with the chamber's id prefix, type and url", async () => {
    const { search } = build([{ id: 3, title: "Weekly review" }]);
    await expect(search("week")).resolves.toEqual([
      { id: "note-3", type: "note", name: "Weekly review", url: "/n/3" },
    ]);
  });

  it("wraps the query in LIKE wildcards and passes the limit through", async () => {
    const searchRows = vi.fn<(pattern: string, limit: number) => Row[]>().mockReturnValue([]);
    const { search } = build([], { searchRows });
    await search("week", 5);
    expect(searchRows).toHaveBeenCalledWith("%week%", 5);
  });

  it("turns an empty query into a match-everything pattern, which is what the picker wants before typing", async () => {
    const searchRows = vi.fn<(pattern: string, limit: number) => Row[]>().mockReturnValue([]);
    const { search } = build([], { searchRows });
    await search("");
    expect(searchRows).toHaveBeenCalledWith("%%", 10);
  });
});

describe("resolve", () => {
  it("preserves the caller's input order regardless of the order rows come back in", async () => {
    // Congress's own resolveExhibits lines results up index-for-index with
    // the ids it asked about, so any reordering here corrupts a Connections
    // panel rather than merely looking untidy.
    const { resolve } = build([
      { id: 1, title: "One" },
      { id: 2, title: "Two" },
      { id: 3, title: "Three" },
    ]);
    const results = await resolve(["note-3", "note-1", "note-2"]);
    expect(results.map((r) => r.id)).toEqual(["note-3", "note-1", "note-2"]);
  });

  it("reports a row that no longer exists as deleted", async () => {
    const { resolve } = build([{ id: 1, title: "One" }]);
    await expect(resolve(["note-9"])).resolves.toEqual([{ id: "note-9", deleted: true }]);
  });

  it("reports an unparseable id as deleted rather than throwing", async () => {
    const { resolve } = build([{ id: 1, title: "One" }]);
    await expect(resolve(["task-1"])).resolves.toEqual([{ id: "task-1", deleted: true }]);
  });

  it("mixes found and missing ids in one call, in order", async () => {
    const { resolve } = build([{ id: 1, title: "One" }]);
    await expect(resolve(["note-9", "note-1"])).resolves.toEqual([
      { id: "note-9", deleted: true },
      { id: "note-1", name: "One", url: "/n/1" },
    ]);
  });

  it("does not query at all when no id is parseable", async () => {
    const resolveRows = vi.fn<(ids: number[]) => Row[]>().mockReturnValue([]);
    const { resolve } = build([], { resolveRows });
    await resolve(["task-1", "bogus"]);
    expect(resolveRows).not.toHaveBeenCalled();
  });

  it("deduplicates repeated ids into a single row query but still answers each occurrence", async () => {
    const resolveRows = vi.fn<(ids: number[]) => Row[]>().mockReturnValue([{ id: 1, title: "One" }]);
    const { resolve } = build([], { resolveRows });
    const results = await resolve(["note-1", "note-1"]);
    expect(resolveRows).toHaveBeenCalledWith([1]);
    expect(results).toEqual([
      { id: "note-1", name: "One", url: "/n/1" },
      { id: "note-1", name: "One", url: "/n/1" },
    ]);
  });
});

describe("chip", () => {
  it("builds the exhibit id, name and url from a raw row id", async () => {
    const { chip } = build([{ id: 4, title: "Notes on X" }]);
    await expect(chip(4)).resolves.toEqual({ id: "note-4", name: "Notes on X", url: "/n/4" });
  });

  it("reports a missing row as deleted, same shape as resolve", async () => {
    const { chip } = build([]);
    await expect(chip(4)).resolves.toEqual({ id: "note-4", deleted: true });
  });
});
