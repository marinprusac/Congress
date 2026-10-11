import { beforeAll, describe, expect, it } from "vitest";
import { migrationsDir } from "@congress/test-support";
import { runMigrations } from "../db/client.js";
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
import { getEventSettingsByType, updateEventSettings } from "../eventSettings.js";
import { listNotifications } from "../notifications.js";
import { handleReceivedEvent } from "../eventReceive.js";
import { runExhibitsMigrations } from "./db/client.js";
import { getTypeBySlug, publish } from "./store.js";
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
});

describe("the e namespace", () => {
  it("ranks search results by score and skips hidden types", async () => {
    const results = await searchExhibits("desert");
    expect(results.map((r) => `${r.chamber}:${r.name}`)).toEqual(["e:Desert Solitaire", "e:Dune"]);
    expect(results[0]).toMatchObject({ type: "book", url: `/${draft}` });
  });

  it("resolves e ids in-process, including deleted ones", async () => {
    const gone = createRecord("book", { title: "Temp" }).id;
    deleteRecord(gone);
    const results = await resolveExhibits([
      { id: dune, chamber: "e" },
      { id: gone, chamber: "e" },
      { id: "nope", chamber: "gone-chamber" },
    ]);
    expect(results).toEqual([
      { id: dune, chamber: "e", name: "Dune", url: `/${dune}`, type: "book" },
      { id: gone, chamber: "e", deleted: true },
      { id: "nope", chamber: "gone-chamber", unavailable: true },
    ]);
  });

  it("builds chips", async () => {
    expect(await getExhibitChip("e", dune)).toMatchObject({ name: "Dune", token: `[[exhibit:e:${dune}|Dune]]` });
    expect(await getExhibitChip("e", "nope")).toEqual({ error: "not_found" });
  });

  it("adds and removes manual connections owned by a record", async () => {
    expect(await addManualConnection(dune, draft, "e")).toEqual({ refs: [draft] });
    expect((await getConnections(dune)).map((c) => c.id)).toEqual([draft]);
    expect((await getConnections(draft)).map((c) => c.id)).toEqual([dune]);
    expect(await removeManualConnection(draft, dune)).toEqual({ refs: [] });
    expect(await getConnections(dune)).toEqual([]);
  });

  it("puts rule candidates in the feed", async () => {
    const feed = await getFeed();
    expect(feed.map((i) => (i.kind === "exhibit" ? `${i.chamber}:${i.name}` : i.viewId))).toEqual(["e:Desert Solitaire"]);
  });

  it("adds catalog entries for visible types only", async () => {
    syncEventCatalog();
    expect(await getEventSettingsByType("book.created")).toMatchObject({ chamber: "types", notify: false });
    expect(await getEventSettingsByType("secret.created")).toBeFalsy();
  });

  it("notifies per the type's own definition, not the settings columns", async () => {
    syncEventCatalog();
    const fire = () =>
      handleReceivedEvent({
        chamber: "types",
        type: "book.created",
        payload: { recordId: "r1", title: "Dune", url: "/e/r1" },
        occurredAt: new Date().toISOString(),
      });
    await fire();
    expect(listNotifications().notifications).toHaveLength(0);

    // The settings request can't switch it on for a type event.
    await updateEventSettings("book.created", { notify: true });
    await fire();
    expect(listNotifications().notifications).toHaveLength(0);
    expect(await getEventSettingsByType("book.created")).toMatchObject({ managedByType: "book", notify: false });

    publish({ actor: "test", ops: [{ op: "set_event_notifications", notifications: [{ event: "created" }] }], typeId: getTypeBySlug("book")!.id });
    await fire();
    expect(await getEventSettingsByType("book.created")).toMatchObject({ notify: true });
    expect(listNotifications().notifications.map((n) => [n.title, n.body])).toEqual([["Book created", "Dune"]]);
  });
});
