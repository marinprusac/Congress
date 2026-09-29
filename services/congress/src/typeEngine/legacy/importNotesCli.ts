// Dry run of the Notes import against copies, never the live DBs:
//   pnpm --filter congress import:notes --from <notes.sqlite3> [--core <capitol.sqlite3>]
// Both files are copied to a temp dir first; prints stats and any mismatch.
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const from = arg("from");
if (!from) {
  console.error("usage: import:notes --from <notes.sqlite3> [--core <capitol.sqlite3>]");
  process.exit(1);
}
const dir = mkdtempSync(join(tmpdir(), "notes-import-dry-"));
const notesCopy = join(dir, "notes.sqlite3");
copyFileSync(resolve(from), notesCopy);
process.env.DB_PATH = join(dir, "capitol.sqlite3");
process.env.EXHIBITS_DB_PATH = join(dir, "exhibits.sqlite3");
const core = arg("core");
if (core) copyFileSync(resolve(core), process.env.DB_PATH);

const { runMigrations } = await import("../../db/client.js");
const { runExhibitsMigrations } = await import("../db/client.js");
const { installPremades } = await import("../premade/index.js");
const { registerLocalSource } = await import("../../exhibitSources.js");
const { typeEngineSource } = await import("../source.js");
const { importLegacyNotes, reconstructContent } = await import("./notesImport.js");
const { resolveLegacyAlias } = await import("../aliases.js");
const { getRecord } = await import("../records.js");

runMigrations();
runExhibitsMigrations();
installPremades();
registerLocalSource(typeEngineSource);
const stats = importLegacyNotes(notesCopy);
console.log("stats:", stats);

const source = new Database(notesCopy, { readonly: true });
const rows = source.prepare("SELECT id, title, frontmatter_json, body, pinned FROM notes").all() as {
  id: number;
  title: string;
  frontmatter_json: string;
  body: string;
  pinned: number;
}[];
let mismatches = 0;
for (const row of rows) {
  const id = resolveLegacyAlias("notes", `note-${row.id}`);
  const record = id ? getRecord(id) : null;
  const body = reconstructContent(JSON.parse(row.frontmatter_json) as Record<string, unknown>, row.body);
  const ok = record && record.values.title === (row.title.trim() || "Untitled note") && record.values.body === body && record.values.pinned === (row.pinned === 1);
  if (!ok) {
    mismatches++;
    console.log(`mismatch: note-${row.id} "${row.title}"`);
  }
}
console.log(`${rows.length} notes, ${mismatches} mismatches. Scratch copies in ${dir}`);
process.exit(mismatches ? 1 : 0);
