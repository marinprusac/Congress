import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { makeFakeChamberModule, migrationsDir } from "@congress/test-support";
import { db, runMigrations } from "../../db/client.js";
import { aiTracking, eventSettings, exhibitCache, exhibitRefs } from "../../db/schema.js";
import { loadChamber } from "../../chambers/loader.js";
import { getCachedChamber, getConnections, removeManualConnection, resolveExhibits, syncExhibit } from "../../exhibits.js";
import { startTypeEngine } from "../index.js";
import { getRecord, listRecords } from "../records.js";
import { resolveLegacyAlias } from "../aliases.js";
import { importLegacyNotes } from "./notesImport.js";

const dir = mkdtempSync(join(tmpdir(), "notes-import-"));
const notesPath = join(dir, "notes.sqlite3");
const created = Date.parse("2025-03-01T10:00:00Z");
const deletedRefs: string[] = [];
let stats: ReturnType<typeof importLegacyNotes>;
let beforeHash: string;
const hash = () => createHash("sha256").update(readFileSync(notesPath)).digest("hex");

beforeAll(async () => {
  // A real chamber-notes DB, built by its own migrations.
  const src = new Database(notesPath);
  migrate(drizzle(src), { migrationsFolder: migrationsDir("chamber-notes") });
  const insert = src.prepare("INSERT INTO notes (id, title, frontmatter_json, body, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  insert.run(1, "Alpha", JSON.stringify({ tags: ["x"] }), "See [[exhibit:notes:note-2|Beta]]", 1, created, created + 5000);
  insert.run(2, "Beta", "{}", "plain body", 0, created + 1000, created + 1000);
  src.prepare("INSERT INTO note_refs (note_id, target_exhibit_id, created_at) VALUES (?, ?, ?)").run(2, "task-9", created);
  src.close();
  beforeHash = hash();

  runMigrations(migrationsDir("congress"));
  const now = new Date();
  // Congress-side state that points at notes.
  db.insert(exhibitCache).values({ id: "note-1", chamber: "notes", type: "note", name: "Alpha", url: "/n/1", updatedAt: now }).run();
  db.insert(exhibitRefs).values({ sourceId: "note-1", sourceChamber: "notes", targetId: "note-2", isManual: false }).run();
  db.insert(exhibitRefs).values({ sourceId: "task-3", sourceChamber: "tasks", targetId: "note-1", isManual: true }).run();
  db.insert(eventSettings)
    .values({
      eventType: "notes.created",
      chamber: "notes",
      label: "Note created",
      notify: true,
      recordToHistory: false,
      notifyTitleTemplate: "New note {{payload.title}}",
      notifyUrlTemplate: "/notes/n/{{payload.noteId}}",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(aiTracking)
    .values({ title: "Watch notes", watchEventsJson: JSON.stringify([{ type: "notes.updated", immediate: true }]), createdAt: now, updatedAt: now })
    .run();

  await loadChamber(
    makeFakeChamberModule("tasks", {
      configure: (app) => {
        app.post("/api/exhibits/resolve", async (c) => {
          const { ids } = (await c.req.json()) as { ids: string[] };
          return c.json({ results: ids.map((id) => ({ id, name: `Task ${id}`, url: `/t/${id}` })) });
        });
        // Tasks still stores its manual ref under the legacy id.
        app.delete("/api/exhibits/:id/refs/:other", (c) => {
          if (c.req.param("other") !== "note-1") return c.json({ error: "not_found" }, 404);
          deletedRefs.push(c.req.param("other"));
          return c.json({ refs: [] });
        });
      },
    }),
    { envFor: () => ({}) }
  );

  startTypeEngine();
  stats = importLegacyNotes(notesPath);
});

describe("importLegacyNotes", () => {
  it("imports every note with its content, timestamps and pin", () => {
    expect(stats).toMatchObject({ notes: 2, refs: 1, eventSettingsCopied: 1, trackingUpdated: 1 });
    const alpha = getRecord(resolveLegacyAlias("notes", "note-1")!)!;
    expect(alpha).toMatchObject({ type: "note", createdAt: new Date(created).toISOString(), updatedAt: new Date(created + 5000).toISOString() });
    expect(alpha.values).toMatchObject({ title: "Alpha", pinned: true });
    expect(alpha.values.body).toBe("---\ntags:\n  - x\n---\nSee [[exhibit:notes:note-2|Beta]]\n");
    expect(listRecords("note")).toHaveLength(2);
  });

  it("rewrites Congress's refs, cache, event settings and tracked items", () => {
    const alpha = resolveLegacyAlias("notes", "note-1")!;
    const beta = resolveLegacyAlias("notes", "note-2")!;
    const refs = db.select().from(exhibitRefs).all().map((r) => `${r.sourceChamber}:${r.sourceId}->${r.targetId}`).sort();
    expect(refs).toEqual([`e:${alpha}->${beta}`, `e:${beta}->task-9`, `tasks:task-3->${alpha}`].sort());
    expect(db.select().from(exhibitCache).where(eq(exhibitCache.chamber, "notes")).all()).toEqual([]);
    const setting = db.select().from(eventSettings).where(eq(eventSettings.eventType, "note.created")).get();
    expect(setting).toMatchObject({ notify: true, recordToHistory: false, notifyUrlTemplate: "/notes/n/{{payload.recordId}}" });
    expect(JSON.parse(db.select().from(aiTracking).get()!.watchEventsJson)).toEqual([{ type: "note.updated", immediate: true }]);
  });

  it("keeps legacy note-N ids working", async () => {
    const alpha = resolveLegacyAlias("notes", "note-1")!;
    expect(await resolveExhibits([{ id: "note-1", chamber: "notes" }])).toEqual([{ id: "note-1", chamber: "e", name: "Alpha", url: `/${alpha}` }]);
    expect(getCachedChamber("note-1")).toBe("e");
    // Another Chamber re-syncing text that still says note-1.
    syncExhibit({ chamber: "tasks", id: "task-4", type: "task", name: "T", url: "/t/4", outgoingRefs: ["note-1"] });
    expect((await getConnections(alpha)).map((c) => c.id)).toContain("task-4");
    expect((await getConnections("note-1")).map((c) => c.id)).toContain("task-3");
  });

  it("removes a Chamber-owned connection stored under the legacy id", async () => {
    const alpha = resolveLegacyAlias("notes", "note-1")!;
    expect(await removeManualConnection(alpha, "task-3")).toEqual({ refs: [] });
    expect(deletedRefs).toEqual(["note-1"]);
  });

  it("runs once and never touches the source file", () => {
    expect(importLegacyNotes(notesPath)).toMatchObject({ skipped: "already_ran" });
    expect(hash()).toBe(beforeHash);
  });
});
