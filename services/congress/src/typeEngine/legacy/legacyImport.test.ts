import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { migrationsDir } from "@congress/test-support";
import { db, runMigrations } from "../../db/client.js";
import { aiTracking, eventSettings, exhibitCache, exhibitRefs } from "../../db/schema.js";
import { exhibitsDb } from "../db/client.js";
import { recordRefs, recordTriggerState } from "../db/schema.js";
import { startTypeEngine } from "../index.js";
import { getRecord } from "../records.js";
import { resolveLegacyAlias } from "../aliases.js";
import { filePath } from "../files.js";
import { addLegacyAlias } from "../aliases.js";
import { importLegacyTasks } from "./tasksImport.js";
import { importLegacyDocuments } from "./documentsImport.js";

const dir = mkdtempSync(join(tmpdir(), "legacy-import-"));
const tasksPath = join(dir, "tasks.sqlite3");
const docsPath = join(dir, "documents.sqlite3");
const docsFiles = join(dir, "documents-files");
const created = Date.parse("2026-03-01T10:00:00Z");
const hash = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
let hashes: string[];
let taskStats: ReturnType<typeof importLegacyTasks>;
let docStats: ReturnType<typeof importLegacyDocuments>;
const rec = (chamber: string, id: string) => getRecord(resolveLegacyAlias(chamber, id)!)!;

beforeAll(() => {
  const tasks = new Database(tasksPath);
  migrate(drizzle(tasks), { migrationsFolder: migrationsDir("chamber-tasks") });
  const insertTask = tasks.prepare(
    "INSERT INTO tasks (id, name, description, due_date, completed, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  // Local midnight (editor) and UTC midnight (MCP) both name 13 Sep in Zagreb.
  insertTask.run(1, "Pay rent", "See [[exhibit:documents:document-1|Lease]]", Date.parse("2026-09-12T22:00:00Z"), 0, null, created, created + 5000);
  insertTask.run(2, "File taxes", "", Date.parse("2026-09-13T00:00:00Z"), 1, created + 9000, created + 1000, created + 9000);
  insertTask.run(3, "  ", "", null, 0, null, created + 2000, created + 2000);
  tasks.prepare("INSERT INTO task_refs (task_id, target_exhibit_id, created_at) VALUES (?, ?, ?)").run(1, "note-7", created);
  tasks.prepare("INSERT INTO task_refs (task_id, target_exhibit_id, created_at) VALUES (?, ?, ?)").run(2, "task-1", created);
  tasks.prepare("INSERT INTO due_notifications (task_id, state) VALUES (?, ?)").run(1, "overdue");
  tasks.prepare("INSERT INTO due_notifications (task_id, state) VALUES (?, ?)").run(99, "overdue");
  tasks.close();

  const docs = new Database(docsPath);
  migrate(drizzle(docs), { migrationsFolder: migrationsDir("chamber-documents") });
  mkdirSync(docsFiles);
  writeFileSync(join(docsFiles, "k1"), "%PDF-lease");
  const insertDoc = docs.prepare(
    "INSERT INTO documents (id, title, filename, mime_type, size_bytes, storage_key, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  insertDoc.run(1, "Lease", "lease.pdf", "application/pdf", 10, "k1", "Signed", created, created);
  insertDoc.run(2, "Lost", "lost.png", "image/png", 3, "gone", "", created, created);
  docs.prepare("INSERT INTO document_refs (document_id, target_exhibit_id, created_at) VALUES (?, ?, ?)").run(1, "task-2", created);
  docs.close();
  hashes = [hash(tasksPath), hash(docsPath), hash(join(docsFiles, "k1"))];

  runMigrations(migrationsDir("congress"));
  startTypeEngine();
  // Note 7 was imported before, like production's notes.
  addLegacyAlias("notes", "note-7", "01notealiasxxxxxxxxxxxxxxx");

  const now = new Date();
  db.insert(exhibitCache).values({ id: "task-1", chamber: "tasks", type: "task", name: "Pay rent", url: "/t/1", updatedAt: now }).run();
  db.insert(exhibitRefs).values({ sourceId: "task-1", sourceChamber: "tasks", targetId: "document-1", isManual: false }).run();
  db.insert(exhibitRefs).values({ sourceId: "evt-1", sourceChamber: "calendar", targetId: "task-1", isManual: true }).run();
  db.insert(eventSettings)
    .values({
      eventType: "tasks.due_soon",
      chamber: "tasks",
      label: "Task due soon",
      notify: true,
      recordToHistory: true,
      notifyTitleTemplate: "{{payload.name}} is due soon",
      notifyDedupeKeyTemplate: "{{payload.taskId}}",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(eventSettings)
    .values({ eventType: "documents.created", chamber: "documents", label: "Document created", notifyUrlTemplate: "/d/{{payload.documentId}}", createdAt: now, updatedAt: now })
    .run();
  db.insert(aiTracking)
    .values({ title: "Chase taxes", watchEventsJson: JSON.stringify([{ type: "tasks.overdue", immediate: true }]), createdAt: now, updatedAt: now })
    .run();

  taskStats = importLegacyTasks(tasksPath);
  docStats = importLegacyDocuments({ db: docsPath, files: docsFiles });
});

describe("tasks import", () => {
  it("keeps content, completion and timestamps, naming due days in the owner's zone", () => {
    expect(taskStats).toMatchObject({ tasks: 3, refs: 2, triggerStates: 1, exhibitRefsRewritten: 1, eventSettingsCopied: 1, trackingUpdated: 1 });
    expect(rec("tasks", "task-1")).toMatchObject({
      values: { title: "Pay rent", due: "2026-09-13", completed: false, completed_at: null },
      createdAt: new Date(created).toISOString(),
      updatedAt: new Date(created + 5000).toISOString(),
    });
    expect(rec("tasks", "task-2").values).toMatchObject({ due: "2026-09-13", completed: true, completed_at: new Date(created + 9000).toISOString() });
    expect(rec("tasks", "task-3").values.title).toBe("Untitled task");
  });

  it("maps manual refs through this and earlier imports, and carries due state", () => {
    const refsOf = (legacy: string) =>
      exhibitsDb
        .select()
        .from(recordRefs)
        .where(eq(recordRefs.recordId, resolveLegacyAlias("tasks", legacy)!))
        .all()
        .map((r) => r.targetExhibitId);
    expect(refsOf("task-1")).toEqual(["01notealiasxxxxxxxxxxxxxxx"]);
    expect(refsOf("task-2")).toEqual([resolveLegacyAlias("tasks", "task-1")]);
    expect(exhibitsDb.select().from(recordTriggerState).all()).toEqual([
      expect.objectContaining({ recordId: resolveLegacyAlias("tasks", "task-1"), ladder: "fld_due", state: "overdue" }),
    ]);
  });

  it("rewrites Congress's refs, cache, event settings and watched events", () => {
    const task1 = resolveLegacyAlias("tasks", "task-1")!;
    expect(db.select().from(exhibitRefs).where(eq(exhibitRefs.sourceId, "evt-1")).get()?.targetId).toBe(task1);
    expect(db.select().from(exhibitCache).where(eq(exhibitCache.id, "task-1")).get()).toBeUndefined();
    expect(db.select().from(exhibitCache).where(eq(exhibitCache.id, task1)).get()).toMatchObject({ chamber: "e", name: "Pay rent" });
    expect(db.select().from(eventSettings).where(eq(eventSettings.eventType, "task.due_soon")).get()).toMatchObject({
      notify: true,
      notifyTitleTemplate: "{{payload.title}} is due soon",
      notifyDedupeKeyTemplate: "{{payload.recordId}}",
    });
    expect(JSON.parse(db.select().from(aiTracking).get()!.watchEventsJson)).toEqual([{ type: "task.overdue", immediate: true }]);
  });
});

describe("documents import", () => {
  it("copies files byte for byte and keeps records whose file is gone", () => {
    expect(docStats).toMatchObject({ documents: 2, bytes: 10, missingFiles: 1, refs: 1, eventSettingsCopied: 1 });
    const lease = rec("documents", "document-1");
    expect(lease.values).toMatchObject({ title: "Lease", description: "Signed", file: { name: "lease.pdf", mime: "application/pdf", size: 10 } });
    expect(readFileSync(filePath((lease.values.file as { id: string }).id), "utf8")).toBe("%PDF-lease");
    expect(rec("documents", "document-2").values).toMatchObject({ title: "Lost", file: null });
    expect(db.select().from(eventSettings).where(eq(eventSettings.eventType, "document.created")).get()?.notifyUrlTemplate).toBe(
      "/d/{{payload.recordId}}"
    );
  });

  it("resolves a task's body token to the imported document", () => {
    const task1 = resolveLegacyAlias("tasks", "task-1")!;
    const doc1 = resolveLegacyAlias("documents", "document-1")!;
    const refs = db.select().from(exhibitRefs).where(eq(exhibitRefs.sourceId, task1)).all().map((r) => r.targetId);
    // Synced as document-1 by the tasks import, rewritten by the documents one.
    expect(refs).toContain(doc1);
    expect(exhibitsDb.select().from(recordRefs).where(eq(recordRefs.recordId, doc1)).get()?.targetExhibitId).toBe(resolveLegacyAlias("tasks", "task-2"));
  });

  it("never touches the sources and runs once", () => {
    expect([hash(tasksPath), hash(docsPath), hash(join(docsFiles, "k1"))]).toEqual(hashes);
    expect(importLegacyTasks(tasksPath).skipped).toBe("already_ran");
    expect(importLegacyDocuments({ db: docsPath, files: docsFiles }).skipped).toBe("already_ran");
  });
});
