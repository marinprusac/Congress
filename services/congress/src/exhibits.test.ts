import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeManifest, migrationsDir, startFakeChamber, type FakeChamber } from "@congress/test-support";
import { db, runMigrations } from "./db/client.js";
import { exhibitCache, exhibitRefs } from "./db/schema.js";
import { deregisterChamber, registerChamber } from "./registry.js";
import {
  getCachedChamber,
  getConnections,
  getExhibitChip,
  getManualConnectionOwner,
  resolveExhibits,
  searchExhibits,
  syncExhibit,
} from "./exhibits.js";

let notes: FakeChamber;
let tasks: FakeChamber;
let broken: FakeChamber;

beforeAll(async () => {
  runMigrations(migrationsDir("congress"));

  notes = await startFakeChamber((app) => {
    app.get("/api/exhibits/search", (c) =>
      c.json({ results: [{ id: "note-1", type: "note", name: `Note for ${c.req.query("q")}`, url: "/n/1" }] })
    );
    app.post("/api/exhibits/resolve", async (c) => {
      const { ids } = (await c.req.json()) as { ids: string[] };
      return c.json({
        results: ids.map((id) => (id === "note-gone" ? { id, deleted: true } : { id, name: `Live ${id}`, url: `/n/${id}` })),
      });
    });
    app.get("/api/exhibits/chip/:rawId", (c) => {
      const rawId = c.req.param("rawId");
      if (rawId === "404") return c.json({ error: "not_found" }, 404);
      return c.json({ id: `note-${rawId}`, name: `Note ${rawId}`, url: `/n/${rawId}` });
    });
  });

  tasks = await startFakeChamber((app) => {
    app.get("/api/exhibits/search", (c) => c.json({ results: [{ id: "task-1", type: "task", name: "A task", url: "/t/1" }] }));
    app.post("/api/exhibits/resolve", async (c) => {
      const { ids } = (await c.req.json()) as { ids: string[] };
      return c.json({ results: ids.map((id) => ({ id, name: `Task ${id}`, url: `/t/${id}` })) });
    });
  });

  broken = await startFakeChamber((app) => {
    app.get("/api/exhibits/search", (c) => c.json({ error: "boom" }, 500));
    app.post("/api/exhibits/resolve", (c) => c.json({ error: "boom" }, 500));
  });

  registerChamber(makeManifest("notes", notes.origin));
  registerChamber(makeManifest("tasks", tasks.origin));
  registerChamber(makeManifest("broken", broken.origin));
});

afterAll(async () => {
  await Promise.all([notes.close(), tasks.close(), broken.close()]);
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
  it("returns an empty array for no refs, without touching any chamber", async () => {
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

  it("resolves a cache miss live against the owning chamber and caches the answer", async () => {
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

  it("marks an exhibit unavailable when its chamber is offline, without failing the whole batch", async () => {
    cached("note-1", "notes", "One");
    registerChamber(makeManifest("temp", "http://127.0.0.1:19098"));
    deregisterChamber("temp");

    const results = await resolveExhibits([
      { id: "note-1", chamber: "notes" },
      { id: "temp-1", chamber: "temp" },
    ]);

    expect(results[0]).toMatchObject({ name: "One" });
    expect(results[1]).toEqual({ id: "temp-1", chamber: "temp", unavailable: true });
  });

  it("marks an exhibit unavailable when its chamber rejects the resolve", async () => {
    await expect(resolveExhibits([{ id: "broken-1", chamber: "broken" }])).resolves.toEqual([
      { id: "broken-1", chamber: "broken", unavailable: true },
    ]);
  });

  it("tombstones an exhibit the owning chamber reports as deleted", async () => {
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
  it("fans out to every active chamber and tags each result with its owner", async () => {
    const results = await searchExhibits("week");
    expect(results).toContainEqual(expect.objectContaining({ id: "note-1", chamber: "notes" }));
    expect(results).toContainEqual(expect.objectContaining({ id: "task-1", chamber: "tasks" }));
  });

  it("passes the query through to each chamber", async () => {
    const results = await searchExhibits("week");
    expect(results.find((r) => r.chamber === "notes")?.name).toBe("Note for week");
  });

  it("drops a failing chamber's results instead of failing the whole search", async () => {
    const results = await searchExhibits("week");
    expect(results.some((r) => r.chamber === "broken")).toBe(false);
    expect(results.length).toBeGreaterThan(0);
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

  it("reports a chamber that is not registered", async () => {
    await expect(getExhibitChip("nosuch", "1")).resolves.toEqual({ error: "chamber_not_found" });
  });

  it("reports a row the chamber does not have", async () => {
    await expect(getExhibitChip("notes", "404")).resolves.toEqual({ error: "not_found" });
  });

  it("reports a chamber that cannot be reached", async () => {
    registerChamber(makeManifest("dead", "http://127.0.0.1:19097"));
    await expect(getExhibitChip("dead", "1")).resolves.toEqual({ error: "chamber_unavailable" });
  });
});
