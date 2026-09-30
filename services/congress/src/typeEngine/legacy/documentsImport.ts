import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { exhibitsDb, exhibitsSqlite } from "../db/client.js";
import { recordRefs } from "../db/schema.js";
import { getTypeByPremadeKey } from "../store.js";
import { createRecord, syncRecordExhibit } from "../records.js";
import { addLegacyAlias } from "../aliases.js";
import { storeFromPath } from "../files.js";
import { ulid } from "../ulid.js";
import { alreadyImported, canonicalTarget, chamberPath, markImported, rewriteCoreDb, type CoreRewriteStats, type LegacySpec } from "./common.js";

// One-time import of the Documents Chamber into the Document type. Files are
// copied, never moved, so the Chamber's data stays intact as a fallback.
// Delete once it has run in production.

export const DOCUMENTS_SPEC: LegacySpec = {
  key: "documents-v1",
  chamber: "documents",
  idPrefix: "document-",
  eventPrefix: "document",
  payloadRenames: { documentId: "recordId" },
};
const DOCUMENTS_DIR = fileURLToPath(new URL("../../../../chamber-documents", import.meta.url));

export function defaultDocumentsPaths(): { db: string; files: string } {
  return {
    db: chamberPath(DOCUMENTS_DIR, "DB_PATH", "./data/documents.sqlite3"),
    files: chamberPath(DOCUMENTS_DIR, "FILES_DIR", "./data/documents-files"),
  };
}

export interface DocumentsImportStats extends Partial<CoreRewriteStats> {
  skipped?: "already_ran" | "no_source" | "no_type";
  documents: number;
  bytes: number;
  missingFiles: number;
  refs: number;
}

interface DocumentRow {
  id: number;
  title: string;
  filename: string;
  mime_type: string;
  storage_key: string;
  description: string;
  created_at: number;
  updated_at: number;
}

export function importLegacyDocuments(from = defaultDocumentsPaths()): DocumentsImportStats {
  const stats: DocumentsImportStats = { documents: 0, bytes: 0, missingFiles: 0, refs: 0 };
  if (alreadyImported(DOCUMENTS_SPEC.key)) return { ...stats, skipped: "already_ran" };
  if (!existsSync(from.db)) return { ...stats, skipped: "no_source" };
  const type = getTypeByPremadeKey("document");
  if (!type) return { ...stats, skipped: "no_type" };

  const source = new Database(from.db, { readonly: true, fileMustExist: true });
  const rows = source
    .prepare("SELECT id, title, filename, mime_type, storage_key, description, created_at, updated_at FROM documents ORDER BY id")
    .all() as DocumentRow[];
  const refs = source.prepare("SELECT document_id, target_exhibit_id FROM document_refs ORDER BY id").all() as {
    document_id: number;
    target_exhibit_id: string;
  }[];
  source.close();

  const idFor = new Map<number, string>();
  for (const row of rows) idFor.set(row.id, ulid(row.created_at));

  // Copy the bytes first (outside the transaction); a copy nothing claims is
  // just orphaned and collected later.
  const fileFor = new Map<number, string>();
  for (const row of rows) {
    const path = join(from.files, row.storage_key);
    if (!existsSync(path)) {
      console.warn(`[types] document-${row.id} "${row.title}": file missing at ${path}`);
      stats.missingFiles++;
      continue;
    }
    const ref = storeFromPath(path, { name: row.filename, mime: row.mime_type }, new Date(row.created_at));
    fileFor.set(row.id, ref.id);
    stats.bytes += ref.size;
  }

  exhibitsSqlite.transaction(() => {
    for (const row of rows) {
      const id = idFor.get(row.id)!;
      const file = fileFor.get(row.id);
      createRecord(
        "document",
        { title: row.title.trim() || row.filename || "Untitled document", description: row.description, ...(file ? { file } : {}) },
        { id, at: new Date(row.created_at), updatedAt: new Date(row.updated_at), silent: true, trusted: true }
      );
      addLegacyAlias(DOCUMENTS_SPEC.chamber, `${DOCUMENTS_SPEC.idPrefix}${row.id}`, id);
      stats.documents++;
    }
    for (const ref of refs) {
      const recordId = idFor.get(ref.document_id);
      if (!recordId) continue;
      exhibitsDb
        .insert(recordRefs)
        .values({ recordId, targetExhibitId: canonicalTarget(ref.target_exhibit_id, DOCUMENTS_SPEC, idFor), createdAt: new Date() })
        .onConflictDoNothing()
        .run();
      stats.refs++;
    }
    markImported(DOCUMENTS_SPEC.key, {});
  })();

  Object.assign(stats, rewriteCoreDb(DOCUMENTS_SPEC, idFor));
  for (const id of idFor.values()) syncRecordExhibit(type, id);
  markImported(DOCUMENTS_SPEC.key, stats);
  return stats;
}
