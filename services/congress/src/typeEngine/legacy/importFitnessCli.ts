// Dry run of the Fitness cutover against copies, never the live DBs:
//   pnpm --filter congress import:fitness --fitness <fitness.sqlite3> --core <capitol.sqlite3>
//     --exhibits <exhibits.sqlite3> --hevy <hevy.sqlite3>
import { copyFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (!v) {
    console.error("usage: import:fitness --fitness <db> --core <db> --exhibits <db> --hevy <db>");
    process.exit(1);
  }
  return resolve(v);
}

const dir = mkdtempSync(join(tmpdir(), "fitness-import-dry-"));
const fitnessCopy = join(dir, "fitness.sqlite3");
copyFileSync(arg("fitness"), fitnessCopy);
process.env.DB_PATH = join(dir, "capitol.sqlite3");
copyFileSync(arg("core"), process.env.DB_PATH);
process.env.EXHIBITS_DB_PATH = join(dir, "exhibits.sqlite3");
copyFileSync(arg("exhibits"), process.env.EXHIBITS_DB_PATH);
process.env.EXHIBIT_FILES_DIR = join(dir, "files");
process.env.CONNECTORS_DATA_DIR = join(dir, "connectors");
mkdirSync(process.env.CONNECTORS_DATA_DIR);
copyFileSync(arg("hevy"), join(process.env.CONNECTORS_DATA_DIR, "hevy.sqlite3"));

const { runMigrations } = await import("../../db/client.js");
const { startTypeEngine } = await import("../index.js");
const { runHevyMigrations } = await import("../../connectors/hevy/db/client.js");
const { runHealthMigrations } = await import("../../connectors/health/db/client.js");
const { importLegacyFitness } = await import("./fitnessImport.js");
const { resolveLegacyAlias } = await import("../aliases.js");
const { listRecords, manualRefs } = await import("../records.js");

runMigrations();
startTypeEngine();
runHevyMigrations();
runHealthMigrations();

const stats = importLegacyFitness({ from: fitnessCopy });
console.log("stats:", JSON.stringify(stats, null, 2));

const fit = new Database(fitnessCopy, { readonly: true });
const workouts = fit.prepare("SELECT id, title FROM workouts").all() as { id: number; title: string }[];
const refs = fit.prepare("SELECT workout_id FROM workout_refs").all() as { workout_id: number }[];
const health = (fit.prepare("SELECT count(*) n FROM health_metrics").get() as { n: number }).n;
let unmapped = 0;
for (const w of workouts) if (!resolveLegacyAlias("fitness", `workout-${w.id}`)) (unmapped++, console.log(`no Workout for: ${w.title}`));
let lost = 0;
for (const r of refs) {
  const id = resolveLegacyAlias("fitness", `workout-${r.workout_id}`);
  if (!id || manualRefs(id).length === 0) lost++;
}
console.log(`Chamber: ${workouts.length} workouts, ${refs.length} links, ${health} health samples`);
console.log(`Records: ${listRecords("workout", { limit: 1000 }).length} workouts, ${listRecords("routine", { limit: 1000 }).length} routines`);
console.log(`${unmapped} workouts unmapped, ${lost} links lost, ${stats.healthSamples}/${health} health samples copied. Scratch copies in ${dir}`);
process.exit(0);
