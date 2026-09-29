import { beforeAll, describe, expect, it } from "vitest";
import { makeFakeChamberModule, migrationsDir } from "@congress/test-support";
import { runMigrations } from "../db/client.js";
import { loadChamber } from "../chambers/loader.js";
import { registerLocalSource } from "../exhibitSources.js";
import {
  addManualConnection,
  getConnections,
  getExhibitChip,
  removeManualConnection,
  resolveExhibits,
  searchExhibits,
} from "../exhibits.js";
import { getFeed } from "../feed.js";
import { syncEventCatalog } from "../eventCatalogSync.js";
import { getEventSettingsByType } from "../eventSettings.js";
import { runExhibitsMigrations } from "./db/client.js";
import { publish } from "./store.js";
import { createRecord, deleteRecord } from "./records.js";
import { typeEngineSource } from "./source.js";

let dune: string;
let draft: string;

beforeAll(async () => {
  runMigrations(migrationsDir("congress"));
  runExhibitsMigrations();
  registerLocalSource(typeEngineSource);
  publish({
    actor: "test",
    ops: [
      { op: "create_type", slug: "book", label: "Book" },
      { op: "add_field", slug: "title", label: "Title", kind: "text", options: { searchable: true } },
      { op: "set_title_field", field: "title" },
      { op: "add_field", slug: "blurb", label: "Blurb", kind: "richtext", options: { searchable: true } },
      { op: "add_field", slug: "read", label: "Read", kind: "boolean" },
      { op: "set_feed_rules", rules: [{ when: { op: "eq", field: "read", value: false }, score: 30, reason: "Unread" }] },
    ],
  });
  publish({
    actor: "test",
    ops: [
      { op: "create_type", slug: "secret", label: "Secret" },
      { op: "add_field", slug: "title", label: "Title", kind: "text" },
      { op: "set_title_field", field: "title" },
      { op: "set_type_meta", hidden: true },
    ],
  });
  dune = createRecord("book", { title: "Dune", blurb: "desert planet", read: true }).id;
  draft = createRecord("book", { title: "Desert Solitaire", read: false }).id;
  createRecord("secret", { title: "Desert secret" });

  await loadChamber(
    makeFakeChamberModule("tasks", {
      configure: (app) => {
        app.get("/api/exhibits/search", (c) => c.json({ results: [{ id: "task-1", type: "task", name: "Desert trip", url: "/t/1", score: 5 }] }));
        app.post("/api/exhibits/resolve", async (c) => {
          const { ids } = (await c.req.json()) as { ids: string[] };
          return c.json({ results: ids.map((id) => ({ id, name: `Task ${id}`, url: `/t/${id}` })) });
        });
        app.get("/api/feed", (c) => c.json({ items: [{ kind: "exhibit", exhibitId: "task-1", score: 50 }] }));
      },
    }),
    { envFor: () => ({}) }
  );
});

describe("the e namespace", () => {
  it("merges search results with Chambers by score and skips hidden types", async () => {
    const results = await searchExhibits("desert");
    expect(results.map((r) => `${r.chamber}:${r.name}`)).toEqual(["e:Desert Solitaire", "tasks:Desert trip", "e:Dune"]);
    expect(results[0]).toMatchObject({ type: "book", url: `/${draft}` });
  });

  it("resolves e ids in-process, including deleted ones", async () => {
    const gone = createRecord("book", { title: "Temp" }).id;
    deleteRecord(gone);
    const results = await resolveExhibits([
      { id: dune, chamber: "e" },
      { id: gone, chamber: "e" },
      { id: "task-1", chamber: "tasks" },
    ]);
    expect(results).toEqual([
      { id: dune, chamber: "e", name: "Dune", url: `/${dune}` },
      { id: gone, chamber: "e", deleted: true },
      { id: "task-1", chamber: "tasks", name: "Task task-1", url: "/t/task-1" },
    ]);
  });

  it("builds chips", async () => {
    expect(await getExhibitChip("e", dune)).toMatchObject({ name: "Dune", token: `[[exhibit:e:${dune}|Dune]]` });
    expect(await getExhibitChip("e", "nope")).toEqual({ error: "not_found" });
  });

  it("adds and removes manual connections owned by a record", async () => {
    expect(await addManualConnection(dune, "task-1", "tasks")).toEqual({ refs: ["task-1"] });
    expect((await getConnections(dune)).map((c) => c.id)).toEqual(["task-1"]);
    expect((await getConnections("task-1")).map((c) => c.id)).toEqual([dune]);
    expect(await removeManualConnection("task-1", dune)).toEqual({ refs: [] });
    expect(await getConnections(dune)).toEqual([]);
  });

  it("puts rule candidates in the feed next to Chamber ones", async () => {
    const feed = await getFeed();
    expect(feed.map((i) => (i.kind === "exhibit" ? `${i.chamber}:${i.name}` : i.viewId))).toEqual(["tasks:Task task-1", "e:Desert Solitaire"]);
  });

  it("adds catalog entries for visible types only", async () => {
    syncEventCatalog();
    expect(await getEventSettingsByType("book.created")).toMatchObject({ chamber: "types", recordToHistory: true, notify: false });
    expect(await getEventSettingsByType("secret.created")).toBeFalsy();
  });
});
