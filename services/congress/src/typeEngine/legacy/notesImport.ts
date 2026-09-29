import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import matter from "gray-matter";
import { eq, like } from "drizzle-orm";
import { db } from "../../db/client.js";
import { aiTracking, eventSettings, exhibitCache, exhibitRefs } from "../../db/schema.js";
import { readChamberEnv } from "../../chambers/loader.js";
import { exhibitsDb, exhibitsSqlite } from "../db/client.js";
import { imports, recordRefs } from "../db/schema.js";
import { getTypeByPremadeKey } from "../store.js";
import { createRecord, syncRecordExhibit } from "../records.js";
import { addLegacyAlias } from "../aliases.js";
import { ulid } from "../ulid.js";

// One-time import of the Notes Chamber into the Note type. Reads its DB
// read-only; other Chambers' text keeps note-N tokens, which resolve through
// legacy_aliases. Delete this once it has run in production.

export const IMPORT_KEY = "notes-v1";
const NOTES_DIR = fileURLToPath(new URL("../../../../chamber-notes", import.meta.url));

export interface NotesImportStats {
  skipped?: "already_ran" | "no_source" | "no_type";
  notes: number;
  refs: number;
  exhibitRefsRewritten: number;
  eventSettingsCopied: number;
  trackingUpdated: number;
}

// Where chamber-notes keeps its DB, per its own .env.
export function defaultNotesDbPath(): string {
  const configured = readChamberEnv(NOTES_DIR).DB_PATH ?? "./data/notes.sqlite3";
  return isAbsolute(configured) ? configured : resolve(NOTES_DIR, configured);
}

export function reconstructContent(frontmatter: Record<string, unknown>, body: string): string {
  if (!frontmatter || Object.keys(frontmatter).length === 0) return body;
  return matter.stringify(body, frontmatter);
}

interface NoteRow {
  id: number;
  title: string;
  frontmatter_json: string;
  body: string;
  pinned: number;
  created_at: number;
  updated_at: number;
}

export function importLegacyNotes(from: string = defaultNotesDbPath()): NotesImportStats {
  const stats: NotesImportStats = { notes: 0, refs: 0, exhibitRefsRewritten: 0, eventSettingsCopied: 0, trackingUpdated: 0 };
  if (exhibitsDb.select().from(imports).where(eq(imports.key, IMPORT_KEY)).get()) return { ...stats, skipped: "already_ran" };
  if (!existsSync(from)) return { ...stats, skipped: "no_source" };
  const type = getTypeByPremadeKey("note");
  if (!type) return { ...stats, skipped: "no_type" };

  const source = new Database(from, { readonly: true, fileMustExist: true });
  const rows = source.prepare("SELECT id, title, frontmatter_json, body, pinned, created_at, updated_at FROM notes ORDER BY id").all() as NoteRow[];
  const refs = source.prepare("SELECT note_id, target_exhibit_id FROM note_refs ORDER BY id").all() as { note_id: number; target_exhibit_id: string }[];
  source.close();

  const idFor = new Map<number, string>();
  for (const row of rows) idFor.set(row.id, ulid(row.created_at));
  const canonical = (target: string) => {
    const m = /^note-(\d+)$/.exec(target);
    return (m && idFor.get(Number(m[1]))) || target;
  };

  exhibitsSqlite.transaction(() => {
    for (const row of rows) {
      const id = idFor.get(row.id)!;
      let frontmatter: Record<string, unknown> = {};
      try {
        frontmatter = JSON.parse(row.frontmatter_json) as Record<string, unknown>;
      } catch {
        // keep the body alone
      }
      createRecord(
        "note",
        { title: row.title.trim() || "Untitled note", body: reconstructContent(frontmatter, row.body), pinned: row.pinned === 1 },
        { id, at: new Date(row.created_at), updatedAt: new Date(row.updated_at), silent: true }
      );
      addLegacyAlias("notes", `note-${row.id}`, id);
      stats.notes++;
    }
    for (const ref of refs) {
      const recordId = idFor.get(ref.note_id);
      if (!recordId) continue;
      exhibitsDb
        .insert(recordRefs)
        .values({ recordId, targetExhibitId: canonical(ref.target_exhibit_id), createdAt: new Date() })
        .onConflictDoNothing()
        .run();
      stats.refs++;
    }
    exhibitsDb.insert(imports).values({ key: IMPORT_KEY, ranAt: new Date(), statsJson: "{}" }).run();
  })();

  db.transaction((tx) => {
    // Notes' own rows are rebuilt by the re-sync below; other owners' rows
    // pointing at a note now point at its record.
    tx.delete(exhibitRefs).where(eq(exhibitRefs.sourceChamber, "notes")).run();
    for (const [legacy, id] of idFor) {
      const res = tx.update(exhibitRefs).set({ targetId: id }).where(eq(exhibitRefs.targetId, `note-${legacy}`)).run();
      stats.exhibitRefsRewritten += res.changes;
    }
    tx.delete(exhibitCache).where(eq(exhibitCache.chamber, "notes")).run();

    for (const row of tx.select().from(eventSettings).where(like(eventSettings.eventType, "notes.%")).all()) {
      const verb = row.eventType.slice("notes.".length);
      const target = `note.${verb}`;
      const rewrite = (t: string | null) => t?.replaceAll("payload.noteId", "payload.recordId") ?? null;
      const config = {
        recordToHistory: row.recordToHistory,
        historyRetentionMs: row.historyRetentionMs,
        notify: row.notify,
        notifyTitleTemplate: rewrite(row.notifyTitleTemplate),
        notifyBodyTemplate: rewrite(row.notifyBodyTemplate),
        notifyUrlTemplate: rewrite(row.notifyUrlTemplate),
        notifyDedupeKeyTemplate: rewrite(row.notifyDedupeKeyTemplate),
        updatedAt: new Date(),
      };
      const existing = tx.select().from(eventSettings).where(eq(eventSettings.eventType, target)).get();
      if (existing) tx.update(eventSettings).set(config).where(eq(eventSettings.eventType, target)).run();
      else tx.insert(eventSettings).values({ ...config, eventType: target, chamber: "types", label: `Note ${verb}`, createdAt: new Date() }).run();
      stats.eventSettingsCopied++;
    }

    for (const item of tx.select().from(aiTracking).where(like(aiTracking.watchEventsJson, '%"notes.%')).all()) {
      tx.update(aiTracking)
        .set({ watchEventsJson: item.watchEventsJson.replace(/"notes\.(created|updated|deleted)"/g, '"note.$1"') })
        .where(eq(aiTracking.id, item.id))
        .run();
      stats.trackingUpdated++;
    }
  });

  for (const id of idFor.values()) syncRecordExhibit(type, id);
  exhibitsDb.update(imports).set({ statsJson: JSON.stringify(stats) }).where(eq(imports.key, IMPORT_KEY)).run();
  return stats;
}
