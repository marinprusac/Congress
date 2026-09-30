// Dry run of the Map cutover against copies, never the live DBs:
//   pnpm --filter congress import:map --map <map.sqlite3> --core <capitol.sqlite3> --exhibits <exhibits.sqlite3>
// Traccar is left out (nothing is polled); the scratch copies can back a local rehearsal.
import { copyFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (!v) {
    console.error("usage: import:map --map <db> --core <db> --exhibits <db>");
    process.exit(1);
  }
  return resolve(v);
}

const dir = mkdtempSync(join(tmpdir(), "map-import-dry-"));
const mapCopy = join(dir, "map.sqlite3");
copyFileSync(arg("map"), mapCopy);
process.env.DB_PATH = join(dir, "capitol.sqlite3");
copyFileSync(arg("core"), process.env.DB_PATH);
process.env.EXHIBITS_DB_PATH = join(dir, "exhibits.sqlite3");
copyFileSync(arg("exhibits"), process.env.EXHIBITS_DB_PATH);
process.env.EXHIBIT_FILES_DIR = join(dir, "files");
process.env.CONNECTORS_DATA_DIR = join(dir, "connectors");
mkdirSync(process.env.CONNECTORS_DATA_DIR);

const { runMigrations } = await import("../../db/client.js");
const { startTypeEngine } = await import("../index.js");
const { runLocationMigrations } = await import("../../connectors/location/db/client.js");
const { importLegacyMap } = await import("./mapImport.js");
const { resolveLegacyAlias } = await import("../aliases.js");
const { listRecords, manualRefs } = await import("../records.js");
const { listVisits, listTrips } = await import("../../connectors/location/visits.js");

runMigrations();
startTypeEngine();
runLocationMigrations();

const stats = importLegacyMap({ from: mapCopy, env: {} });
console.log("stats:", JSON.stringify(stats, null, 2));

const map = new Database(mapCopy, { readonly: true });
const places = map.prepare("SELECT id, name FROM places").all() as { id: number; name: string }[];
const count = (t: string) => (map.prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n;
const labelled = (map.prepare("SELECT count(*) n FROM visits WHERE status IN ('adhoc', 'ignored')").get() as { n: number }).n;
let lost = 0;
for (const p of places) {
  const id = resolveLegacyAlias("map", `place-${p.id}`);
  if (!id) (lost++, console.log(`place lost: ${p.name}`));
}
const visits = await listVisits({ limit: 100_000 });
const refs = (map.prepare("SELECT place_id FROM place_refs").all() as { place_id: number }[]).filter((r) => {
  const id = resolveLegacyAlias("map", `place-${r.place_id}`);
  return !id || manualRefs(id).length === 0;
}).length;
console.log(`Chamber: ${places.length} places, ${count("positions")} positions, ${count("visits")} visits (${labelled} labelled or ignored), ${count("trips")} trips, ${count("place_refs")} links`);
console.log(`Now: ${listRecords("place", { limit: 1000 }).length} Place records, ${visits.length} visits (${visits.filter((v) => v.status === "adhoc" || v.status === "ignored").length} labelled or ignored), ${(await listTrips({ limit: 100_000 })).length} trips`);
console.log(`${lost} places lost, ${refs} links lost. Scratch copies in ${dir}`);
process.exit(0);
