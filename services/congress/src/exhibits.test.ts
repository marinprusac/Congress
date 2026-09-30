import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ExhibitResolveResult, ExhibitSearchResult } from "@congress/shared-types";
import { migrationsDir } from "@congress/test-support";
import { db, runMigrations } from "./db/client.js";
import { exhibitCache, exhibitRefs } from "./db/schema.js";
import { registerLocalSource, type LocalExhibitSource } from "./exhibitSources.js";
import {
  getCachedChamber,
  getConnections,
  getExhibitChip,
  getManualConnectionOwner,
  resolveExhibits,
  searchExhibits,
  syncExhibit,
} from "./exhibits.js";

// An in-process exhibit source, registered the way the type engine registers its own.
function makeSource(namespace: string, parts: Partial<LocalExhibitSource>): LocalExhibitSource {
  const source: LocalExhibitSource = {
    namespace,
    search: () => [],
    resolve: (ids) => ids.map((id): ExhibitResolveResult => ({ id, name: `Live ${id}`, url: `/x/${id}` })),
    typeOf: () => null,
    chip: () => null,
    addManualRef: () => null,
    removeManualRef: () => null,
    feedCandidates: () => [],
    ...parts,
  };
  registerLocalSource(source);
  return source;
}

const result = (id: string, name: string, score?: number): ExhibitSearchResult => ({ id, type: "note", name, url: `/x/${id}`, score });

beforeAll(() => {
  runMigrations(migrationsDir("congress"));

  makeSource("notes", {
    search: (q) => [result("note-1", `Note for ${q}`)],
    resolve: (ids) => ids.map((id) => (id === "note-gone" ? { id, deleted: true as const } : { id, name: `Live ${id}`, url: `/n/${id}` })),
    chip: (raw) => (raw === "404" ? null : { id: `note-${raw}`, name: `Note ${raw}`, url: `/n/${raw}` }),
  });
  makeSource("tasks", { search: () => [result("task-1", "A task")], resolve: (ids) => ids.map((id) => ({ id, name: `Task ${id}`, url: `/t/${id}` })) });
  makeSource("broken", {
    search: () => {
      throw new Error("boom");
    },
  });
  // Mirrors the type engine: a score only for a non-empty query.
  makeSource("low", { search: (q) => [result("low-1", "Low score match", q ? 1 : undefined)] });
  makeSource("high", { search: (q) => [result("high-1", "High score match", q ? 6 : undefined)] });
});

beforeEach(() => {
  db.run(sql`delete from exhibit_refs`);
  db.run(sql`delete from exhibit_cache`);
});

function cached(id: string, chamber = "notes", name = id, deleted = false) {
  syncExhibit({ chamber, id, type: "note", name, url: `/x/${id}`, deleted, outgoingRefs: [] });
}

describe("syncExhibit", () => {
  it("inserts a cache row and its outgoing refs", () => {
    syncExhibit({ chamber: "notes", id: "note-1", type: "note", name: "One", url: "/n/1", outgoingRefs: ["task-2"] });

    expect(db.select().from(exhibitCache).all()).toEqual([expect.objectContaining({ id: "note-1", name: "One" })]);
    expect(db.select().from(exhibitRefs).all()).toEqual([
      expect.objectContaining({ sourceId: "note-1", sourceChamber: "notes", targetId: "task-2", isManual: false }),
    ]);
  });

  it("updates the cache row in place on a re-sync rather than inserting a second one", () => {
    syncExhibit({ chamber: "notes", id: "note-1", type: "note", name: "One", url: "/n/1", outgoingRefs: [] });
    syncExhibit({ chamber: "notes", id: "note-1", type: "note", name: "Renamed", url: "/n/1", outgoingRefs: [] });

    const rows = db.select().from(exhibitCache).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Renamed");
  });

  it("replaces the source's refs wholesale, so a removed link disappears", () => {
    syncExhibit({ chamber: "notes", id: "note-1", type: "note", name: "One", url: "/n/1", outgoingRefs: ["task-2", "task-3"] });
    syncExhibit({ chamber: "notes", id: "note-1", type: "note", name: "One", url: "/n/1", outgoingRefs: ["task-3"] });

    expect(db.select().from(exhibitRefs).all().map((r) => r.targetId)).toEqual(["task-3"]);
  });

  it("only deletes the syncing source's own rows, leaving another exhibit's refs intact", () => {
    // Each side's sync owns exactly the rows it discovered; a Chamber
    // re-syncing must not wipe a connection the other side established.
    syncExhibit({ chamber: "tasks", id: "task-9", type: "task", name: "Nine", url: "/t/9", outgoingRefs: ["note-1"] });
    syncExhibit({ chamber: "notes", id: "note-1", type: "note", name: "One", url: "/n/1", outgoingRefs: [] });

    expect(db.select().from(exhibitRefs).all()).toHaveLength(1);
    expect(db.select().from(exhibitRefs).all()[0]?.sourceId).toBe("task-9");
  });

  it("flags exactly the refs named in manualRefs", () => {
    syncExhibit({
      chamber: "notes",
      id: "note-1",
      type: "note",
      name: "One",
      url: "/n/1",
      outgoingRefs: ["task-2", "task-3"],
      manualRefs: ["task-3"],
    });

    const byTarget = Object.fromEntries(db.select().from(exhibitRefs).all().map((r) => [r.targetId, r.isManual]));
    expect(byTarget).toEqual({ "task-2": false, "task-3": true });
  });

  it("records a deletion as a tombstone rather than removing the row", () => {
    syncExhibit({ chamber: "notes", id: "note-1", type: "note", name: "One", url: "/n/1", outgoingRefs: [] });
    syncExhibit({ chamber: "notes", id: "note-1", type: "", name: "", url: "", deleted: true, outgoingRefs: [] });

    expect(db.select().from(exhibitCache).all()[0]?.deleted).toBe(true);
  });
});

describe("getCachedChamber", () => {
  it("reports the owning chamber for a cached id", () => {
    cached("note-1", "notes");
    expect(getCachedChamber("note-1")).toBe("notes");
  });

  it("returns null for an id that has never synced, rather than guessing", () => {
    expect(getCachedChamber("note-999")).toBeNull();
  });
});

describe("resolveExhibits", () => {
  it("returns an empty array for no refs, without touching any source", async () => {
    await expect(resolveExhibits([])).resolves.toEqual([]);
  });

  it("answers entirely from the cache when every id is known", async () => {
    cached("note-1", "notes", "One");
    cached("task-2", "tasks", "Two");

    await expect(resolveExhibits([{ id: "note-1", chamber: "notes" }, { id: "task-2", chamber: "tasks" }])).resolves.toEqual([
      { id: "note-1", chamber: "notes", name: "One", url: "/x/note-1" },
      { id: "task-2", chamber: "tasks", name: "Two", url: "/x/task-2" },
    ]);
  });

  it("reports a tombstoned exhibit as deleted", async () => {
    cached("note-1", "notes", "One", true);
    await expect(resolveExhibits([{ id: "note-1", chamber: "notes" }])).resolves.toEqual([
      { id: "note-1", chamber: "notes", deleted: true },
    ]);
  });

  it("resolves a cache miss live against the owning source and caches the answer", async () => {
    const [result] = await resolveExhibits([{ id: "note-7", chamber: "notes" }]);
    expect(result).toEqual({ id: "note-7", chamber: "notes", name: "Live note-7", url: "/n/note-7" });
    expect(getCachedChamber("note-7")).toBe("notes");
  });

  it("preserves input order across a mix of cache hits and live misses in different chambers", async () => {
    // getConnections lines its own isManual map up against this result
    // index-for-index, so a reordering here mislabels connections.
    cached("note-1", "notes", "Cached one");

    const results = await resolveExhibits([
      { id: "task-5", chamber: "tasks" },
      { id: "note-1", chamber: "notes" },
      { id: "note-8", chamber: "notes" },
    ]);

    expect(results.map((r) => r.id)).toEqual(["task-5", "note-1", "note-8"]);
    expect(results[1]).toMatchObject({ name: "Cached one" });
  });

  it("marks an exhibit unavailable when its namespace has no source, without failing the whole batch", async () => {
    cached("note-1", "notes", "One");

    const results = await resolveExhibits([
      { id: "note-1", chamber: "notes" },
      { id: "temp-1", chamber: "temp" },
    ]);

    expect(results[0]).toMatchObject({ name: "One" });
    expect(results[1]).toEqual({ id: "temp-1", chamber: "temp", unavailable: true });
  });

  it("tombstones an exhibit the owning source reports as deleted", async () => {
    await expect(resolveExhibits([{ id: "note-gone", chamber: "notes" }])).resolves.toEqual([
      { id: "note-gone", chamber: "notes", deleted: true },
    ]);
    expect(db.select().from(exhibitCache).all()[0]).toMatchObject({ id: "note-gone", deleted: true });
  });
});

describe("getConnections", () => {
  it("returns nothing for an exhibit with no refs on either side", async () => {
    await expect(getConnections("note-1")).resolves.toEqual([]);
  });

  it("finds a connection this exhibit established", async () => {
    cached("task-2", "tasks", "Two");
    syncExhibit({ chamber: "notes", id: "note-1", type: "note", name: "One", url: "/n/1", outgoingRefs: ["task-2"] });

    await expect(getConnections("note-1")).resolves.toEqual([
      { id: "task-2", chamber: "tasks", name: "Two", url: "/x/task-2", isManual: false },
    ]);
  });

  it("finds a connection the other side established, with no direction visible to the caller", async () => {
    // Storage is directed for sync bookkeeping only - a Connection is
    // undirected as far as anyone reading it is concerned.
    syncExhibit({ chamber: "tasks", id: "task-2", type: "task", name: "Two", url: "/t/2", outgoingRefs: ["note-1"] });

    await expect(getConnections("note-1")).resolves.toEqual([
      { id: "task-2", chamber: "tasks", name: "Two", url: "/t/2", isManual: false },
    ]);
  });

  it("collapses a mutual reference into a single entry", async () => {
    cached("task-2", "tasks", "Two");
    syncExhibit({ chamber: "notes", id: "note-1", type: "note", name: "One", url: "/n/1", outgoingRefs: ["task-2"] });
    syncExhibit({ chamber: "tasks", id: "task-2", type: "task", name: "Two", url: "/t/2", outgoingRefs: ["note-1"] });

    const connections = await getConnections("note-1");
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({ id: "task-2" });
  });

  it("treats a connection as manual if either side flagged it manual", async () => {
    cached("task-2", "tasks", "Two");
    syncExhibit({ chamber: "notes", id: "note-1", type: "note", name: "One", url: "/n/1", outgoingRefs: ["task-2"] });
    syncExhibit({
      chamber: "tasks",
      id: "task-2",
      type: "task",
      name: "Two",
      url: "/t/2",
      outgoingRefs: ["note-1"],
      manualRefs: ["note-1"],
    });

    expect((await getConnections("note-1"))[0]?.isManual).toBe(true);
  });

  it("skips an outgoing target whose chamber is neither recorded nor cached", async () => {
    // The row records sourceChamber, not targetChamber - so an id this
    // exhibit points at that has never synced has nothing to route a
    // resolve through and is dropped rather than guessed at.
    syncExhibit({ chamber: "notes", id: "note-1", type: "note", name: "One", url: "/n/1", outgoingRefs: ["mystery-9"] });
    await expect(getConnections("note-1")).resolves.toEqual([]);
  });

  it("routes an outgoing target through its cached chamber when the row does not name one", async () => {
    cached("task-2", "tasks", "Two");
    syncExhibit({ chamber: "notes", id: "note-1", type: "note", name: "One", url: "/n/1", outgoingRefs: ["task-2"] });
    expect((await getConnections("note-1"))[0]?.chamber).toBe("tasks");
  });

  it("keeps each connection's isManual aligned with its own entry across several connections", async () => {
    cached("task-2", "tasks", "Two");
    cached("doc-3", "documents", "Three");
    cached("task-4", "tasks", "Four");
    syncExhibit({
      chamber: "notes",
      id: "note-1",
      type: "note",
      name: "One",
      url: "/n/1",
      outgoingRefs: ["task-2", "doc-3", "task-4"],
      manualRefs: ["doc-3"],
    });

    const byId = Object.fromEntries((await getConnections("note-1")).map((c) => [c.id, c.isManual]));
    expect(byId).toEqual({ "task-2": false, "doc-3": true, "task-4": false });
  });
});

describe("getManualConnectionOwner", () => {
  beforeEach(() => {
    syncExhibit({
      chamber: "notes",
      id: "note-1",
      type: "note",
      name: "One",
      url: "/n/1",
      outgoingRefs: ["task-2"],
      manualRefs: ["task-2"],
    });
  });

  it("finds the owning row from the side that established it", () => {
    expect(getManualConnectionOwner("note-1", "task-2")).toEqual({ ownerId: "note-1", chamber: "notes" });
  });

  it("finds the same row from the other side, since a connection has no owner in the UI", () => {
    expect(getManualConnectionOwner("task-2", "note-1")).toEqual({ ownerId: "note-1", chamber: "notes" });
  });

  it("returns null when the connection exists but was not manual", () => {
    syncExhibit({ chamber: "notes", id: "note-5", type: "note", name: "Five", url: "/n/5", outgoingRefs: ["task-6"] });
    expect(getManualConnectionOwner("note-5", "task-6")).toBeNull();
  });

  it("returns null when there is no connection at all", () => {
    expect(getManualConnectionOwner("note-1", "nope-1")).toBeNull();
  });
});

describe("searchExhibits", () => {
  it("merges every source and tags each result with its owner", async () => {
    const results = await searchExhibits("week");
    expect(results).toContainEqual(expect.objectContaining({ id: "note-1", chamber: "notes" }));
    expect(results).toContainEqual(expect.objectContaining({ id: "task-1", chamber: "tasks" }));
  });

  it("passes the query through to each source", async () => {
    const results = await searchExhibits("week");
    expect(results.find((r) => r.chamber === "notes")?.name).toBe("Note for week");
  });

  it("drops a failing source's results instead of failing the whole search", async () => {
    const results = await searchExhibits("week");
    expect(results.some((r) => r.chamber === "broken")).toBe(false);
    expect(results.length).toBeGreaterThan(0);
  });

  it("ranks a higher-scoring result first regardless of registration order", async () => {
    const ids = (await searchExhibits("query")).map((r) => r.id);
    expect(ids.indexOf("high-1")).toBeLessThan(ids.indexOf("low-1"));
  });

  it("ranks a source that omits score entirely beneath any source with a positive score", async () => {
    // A missing score is 0, not "unranked and therefore first".
    const ids = (await searchExhibits("query")).map((r) => r.id);
    expect(ids.indexOf("high-1")).toBeLessThan(ids.indexOf("note-1"));
    expect(ids.indexOf("high-1")).toBeLessThan(ids.indexOf("task-1"));
  });

  it("leaves an empty query's results without a score", async () => {
    const results = await searchExhibits("");
    expect(results.every((r) => r.score === undefined)).toBe(true);
  });
});

describe("getExhibitChip", () => {
  it("builds a paste-ready chip token from a raw row id", async () => {
    await expect(getExhibitChip("notes", "3")).resolves.toEqual({
      id: "note-3",
      chamber: "notes",
      name: "Note 3",
      url: "/n/3",
      token: "[[exhibit:notes:note-3|Note 3]]",
    });
  });

  it("reports a namespace that has no source", async () => {
    await expect(getExhibitChip("nosuch", "1")).resolves.toEqual({ error: "chamber_not_found" });
  });

  it("reports a row the source does not have", async () => {
    await expect(getExhibitChip("notes", "404")).resolves.toEqual({ error: "not_found" });
  });
});

describe("live resolve re-sync", () => {
  it("keeps an exhibit's manual connections manual", async () => {
    syncExhibit({ chamber: "notes", id: "note-77", type: "note", name: "N", url: "/n/77", outgoingRefs: ["task-1", "task-2"], manualRefs: ["task-2"] });
    db.delete(exhibitCache).where(sql`${exhibitCache.id} = 'note-77'`).run();
    await resolveExhibits([{ id: "note-77", chamber: "notes" }]);
    const rows = db.select().from(exhibitRefs).where(sql`${exhibitRefs.sourceId} = 'note-77'`).all();
    expect(rows.map((r) => [r.targetId, r.isManual]).sort()).toEqual([
      ["task-1", false],
      ["task-2", true],
    ]);
  });
});
