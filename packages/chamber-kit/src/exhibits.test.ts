import { afterEach, describe, expect, it, vi } from "vitest";
import { createPushExhibitSync, createTableBackedExhibits, scoreExhibitMatch } from "./exhibits.js";

interface Row {
  id: number;
  title: string;
  body?: string;
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
    searchRows: (pattern, limit) => {
      const needle = pattern.replaceAll("%", "").toLowerCase();
      return rows
        .filter((r) => r.title.toLowerCase().includes(needle) || (r.body ?? "").toLowerCase().includes(needle))
        .slice(0, limit);
    },
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
      { id: "note-3", type: "note", name: "Weekly review", url: "/n/3", score: expect.any(Number) },
    ]);
  });

  it("wraps the query in LIKE wildcards, and for a non-empty query requests a wide candidate window rather than the caller's own limit", async () => {
    // A non-empty query needs a much wider candidate set than the caller's
    // final `limit` so scoring has enough rows to find an exact match that
    // isn't among the most recently touched - see the regression test below
    // for the actual bug this fixes. The final result is still trimmed to
    // `limit` after scoring (covered by the regression test), just not at
    // the SQL layer any more.
    const searchRows = vi.fn<(pattern: string, limit: number) => Row[]>().mockReturnValue([]);
    const { search } = build([], { searchRows });
    await search("week", 5);
    expect(searchRows).toHaveBeenCalledWith("%week%", 200);
  });

  it("turns an empty query into a match-everything pattern, which is what the picker wants before typing", async () => {
    const searchRows = vi.fn<(pattern: string, limit: number) => Row[]>().mockReturnValue([]);
    const { search } = build([], { searchRows });
    await search("");
    // Unlike a non-empty query, empty ("browse recent") mode still requests
    // exactly `limit` rows - no scoring applies, so there's nothing to gain
    // from widening the candidate window.
    expect(searchRows).toHaveBeenCalledWith("%%", 10);
  });

  it("ranks an exact title match first even when it sorts last in searchRows' own recency order", async () => {
    // The exact shape of the reported bug: a note titled exactly "ESN" that
    // hasn't been touched recently, buried behind 11 other notes that only
    // match because "esn" appears somewhere in their body text and were
    // edited more recently.
    const decoys = Array.from({ length: 11 }, (_, i) => ({
      id: i + 1,
      title: `Decoy ${i + 1}`,
      body: "some text mentioning esn in passing",
    }));
    const exactMatch = { id: 99, title: "ESN", body: "" };
    const { search } = build([...decoys, exactMatch]);

    const results = await search("ESN");
    expect(results[0]).toMatchObject({ id: "note-99", name: "ESN" });
  });

  it("still finds a body-only match, ranked below any title match", async () => {
    const titleMatch = { id: 1, title: "ESN", body: "" };
    const bodyOnlyMatch = { id: 2, title: "Unrelated", body: "mentions esn once" };
    const { search } = build([bodyOnlyMatch, titleMatch]);

    const results = await search("ESN");
    expect(results.map((r) => r.id)).toEqual(["note-1", "note-2"]);
  });

  it("attaches no score to results for an empty query", async () => {
    const { search } = build([{ id: 1, title: "One" }]);
    const results = await search("");
    expect(results.every((r) => r.score === undefined)).toBe(true);
  });

  it("attaches a score to results for a non-empty query", async () => {
    const { search } = build([{ id: 1, title: "One" }]);
    const results = await search("one");
    expect(results[0]?.score).toBeGreaterThan(0);
  });
});

describe("scoreExhibitMatch", () => {
  it("ranks an exact primary-field match above every other tier", () => {
    const exact = scoreExhibitMatch("esn", [{ text: "ESN", isPrimary: true }]);
    const prefix = scoreExhibitMatch("esn", [{ text: "ESN Kickoff", isPrimary: true }]);
    expect(exact).toBeGreaterThan(prefix);
  });

  it("ranks a primary-field prefix match above a word-boundary match", () => {
    const prefix = scoreExhibitMatch("esn", [{ text: "ESN Kickoff", isPrimary: true }]);
    const wordBoundary = scoreExhibitMatch("esn", [{ text: "Notes on ESN today", isPrimary: true }]);
    expect(prefix).toBeGreaterThan(wordBoundary);
  });

  it("ranks a primary-field word-boundary match above a bare substring match", () => {
    const wordBoundary = scoreExhibitMatch("esn", [{ text: "Notes on ESN today", isPrimary: true }]);
    const substring = scoreExhibitMatch("esn", [{ text: "Xesny device", isPrimary: true }]);
    expect(wordBoundary).toBeGreaterThan(substring);
  });

  it("ranks any primary-field match above every secondary-field match", () => {
    const primarySubstring = scoreExhibitMatch("esn", [{ text: "Xesny device", isPrimary: true }]);
    const secondaryWordBoundary = scoreExhibitMatch("esn", [{ text: "Discuss ESN rollout", isPrimary: false }]);
    expect(primarySubstring).toBeGreaterThan(secondaryWordBoundary);
  });

  it("ranks a secondary-field word-boundary match above a secondary-field substring match", () => {
    const wordBoundary = scoreExhibitMatch("esn", [{ text: "Discuss ESN rollout", isPrimary: false }]);
    const substring = scoreExhibitMatch("esn", [{ text: "Xesny device", isPrimary: false }]);
    expect(wordBoundary).toBeGreaterThan(substring);
  });

  it("is case-insensitive", () => {
    expect(scoreExhibitMatch("ESN", [{ text: "esn", isPrimary: true }])).toBe(
      scoreExhibitMatch("esn", [{ text: "ESN", isPrimary: true }])
    );
  });

  it("returns 0 when no field matches at all", () => {
    expect(scoreExhibitMatch("esn", [{ text: "Weekly review", isPrimary: true }])).toBe(0);
  });

  it("takes the best score across multiple fields", () => {
    const score = scoreExhibitMatch("esn", [
      { text: "Unrelated", isPrimary: true },
      { text: "ESN", isPrimary: false },
    ]);
    const bodyOnly = scoreExhibitMatch("esn", [{ text: "ESN", isPrimary: false }]);
    expect(score).toBe(bodyOnly);
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

describe("createPushExhibitSync", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function stubFetch(handler: () => Response | never) {
    const calls: { url: string; init: { headers?: Record<string, string>; body?: string } }[] = [];
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init: (init ?? {}) as { headers?: Record<string, string>; body?: string } });
      return handler();
    }) as unknown as typeof fetch;
    return calls;
  }

  it("posts chamber + the push payload to Capitol's exhibits sync endpoint with the internal token header", async () => {
    const calls = stubFetch(() => new Response(null, { status: 200 }));
    const pushExhibitSync = createPushExhibitSync({
      chamber: "notes",
      capitolUrl: "http://127.0.0.1:19999",
      internalToken: "test-token",
    });

    await pushExhibitSync({ id: "note-1", type: "note", name: "One", url: "/n/1", outgoingRefs: [] });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://127.0.0.1:19999/congress/exhibits/sync");
    expect(calls[0]!.init.headers).toMatchObject({ "X-Congress-Internal-Token": "test-token" });
    expect(JSON.parse(calls[0]!.init.body!)).toEqual({
      chamber: "notes",
      id: "note-1",
      type: "note",
      name: "One",
      url: "/n/1",
      outgoingRefs: [],
    });
  });

  it("resolves without throwing when Capitol responds non-ok", async () => {
    stubFetch(() => new Response(null, { status: 500 }));
    const pushExhibitSync = createPushExhibitSync({
      chamber: "notes",
      capitolUrl: "http://127.0.0.1:19999",
      internalToken: "test-token",
    });
    await expect(
      pushExhibitSync({ id: "note-1", type: "note", name: "One", url: "/n/1", outgoingRefs: [] })
    ).resolves.toBeUndefined();
  });

  it("resolves without throwing when fetch itself throws", async () => {
    stubFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    const pushExhibitSync = createPushExhibitSync({
      chamber: "notes",
      capitolUrl: "http://127.0.0.1:19999",
      internalToken: "test-token",
    });
    await expect(
      pushExhibitSync({ id: "note-1", type: "note", name: "One", url: "/n/1", outgoingRefs: [] })
    ).resolves.toBeUndefined();
  });
});
