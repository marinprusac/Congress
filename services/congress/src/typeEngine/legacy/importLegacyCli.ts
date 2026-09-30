// Dry run of the Tasks + Documents imports against copies, never the live DBs:
//   pnpm --filter congress import:legacy --tasks <tasks.sqlite3> --documents <documents.sqlite3>
//     --documents-files <dir> [--core <capitol.sqlite3>] [--exhibits <exhibits.sqlite3>]
// DBs are copied to a temp dir first (files are only read); prints stats and mismatches.
import { copyFileSync, createReadStream, mkdtempSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const tasksFrom = arg("tasks");
const docsFrom = arg("documents");
const docsFiles = arg("documents-files");
if (!tasksFrom || !docsFrom || !docsFiles) {
  console.error("usage: import:legacy --tasks <db> --documents <db> --documents-files <dir> [--core <db>] [--exhibits <db>]");
  process.exit(1);
}
const dir = mkdtempSync(join(tmpdir(), "legacy-import-dry-"));
const tasksCopy = join(dir, "tasks.sqlite3");
const docsCopy = join(dir, "documents.sqlite3");
copyFileSync(resolve(tasksFrom), tasksCopy);
copyFileSync(resolve(docsFrom), docsCopy);
process.env.DB_PATH = join(dir, "capitol.sqlite3");
process.env.EXHIBITS_DB_PATH = join(dir, "exhibits.sqlite3");
process.env.EXHIBIT_FILES_DIR = join(dir, "files");
const core = arg("core");
if (core) copyFileSync(resolve(core), process.env.DB_PATH);
const exhibits = arg("exhibits");
if (exhibits) copyFileSync(resolve(exhibits), process.env.EXHIBITS_DB_PATH);

const { runMigrations } = await import("../../db/client.js");
const { runExhibitsMigrations } = await import("../db/client.js");
const { installPremades } = await import("../premade/index.js");
const { registerLocalSource } = await import("../../exhibitSources.js");
const { typeEngineSource } = await import("../source.js");
const { refreshOwnerZone } = await import("../zone.js");
const { importLegacyTasks, taskValues } = await import("./tasksImport.js");
const { importLegacyDocuments } = await import("./documentsImport.js");
const { resolveLegacyAlias } = await import("../aliases.js");
const { getRecord } = await import("../records.js");
const { getFile, filePath } = await import("../files.js");

runMigrations();
runExhibitsMigrations();
installPremades();
registerLocalSource(typeEngineSource);
await refreshOwnerZone();
console.log("tasks:", importLegacyTasks(tasksCopy));
console.log("documents:", importLegacyDocuments({ db: docsCopy, files: resolve(docsFiles) }));

const sha = (path: string) =>
  new Promise<string>((ok, fail) => {
    const h = createHash("sha256");
    createReadStream(path).on("data", (d) => h.update(d)).on("end", () => ok(h.digest("hex"))).on("error", fail);
  });

let mismatches = 0;
const miss = (what: string) => {
  mismatches++;
  console.log(`mismatch: ${what}`);
};

const tdb = new Database(tasksCopy, { readonly: true });
const tasks = tdb.prepare("SELECT * FROM tasks").all() as Parameters<typeof taskValues>[0][];
for (const row of tasks) {
  const id = resolveLegacyAlias("tasks", `task-${row.id}`);
  const rec = id ? getRecord(id) : null;
  const want = taskValues(row);
  if (!rec || Object.entries(want).some(([k, v]) => rec.values[k] !== v)) miss(`task-${row.id} "${row.name}" ${JSON.stringify(rec?.values)} vs ${JSON.stringify(want)}`);
  else if (row.due_date !== null) console.log(`  task-${row.id}: ${new Date(row.due_date).toISOString()} -> ${want.due}`);
}

const ddb = new Database(docsCopy, { readonly: true });
const docs = ddb.prepare("SELECT id, title, filename, storage_key, description, size_bytes FROM documents").all() as {
  id: number;
  title: string;
  filename: string;
  storage_key: string;
  description: string;
  size_bytes: number;
}[];
for (const row of docs) {
  const id = resolveLegacyAlias("documents", `document-${row.id}`);
  const rec = id ? getRecord(id) : null;
  const file = rec?.values.file as { id: string; size: number; name: string } | null | undefined;
  if (!rec || rec.values.description !== row.description || !file || file.name !== row.filename || file.size !== row.size_bytes) {
    miss(`document-${row.id} "${row.title}"`);
    continue;
  }
  const [a, b] = [await sha(join(resolve(docsFiles), row.storage_key)), await sha(filePath(file.id))];
  if (a !== b || getFile(file.id)?.sha256 !== a) miss(`document-${row.id} bytes differ`);
}
console.log(`${tasks.length} tasks, ${docs.length} documents, ${mismatches} mismatches. Scratch copies in ${dir}`);
process.exit(mismatches ? 1 : 0);
