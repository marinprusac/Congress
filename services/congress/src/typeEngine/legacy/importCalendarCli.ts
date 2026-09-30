// Dry run of the Calendar cutover against copies, never the live DBs:
//   pnpm --filter congress import:calendar --calendar <calendar.sqlite3> --core <capitol.sqlite3>
//     --exhibits <exhibits.sqlite3> --gcal <google-calendar.sqlite3>
// Nothing reaches Google: the connector's cache is read as is (no sync), so
// events of calendars the connector doesn't sync yet show as "after the sync".
import { copyFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (!v) {
    console.error("usage: import:calendar --calendar <db> --core <db> --exhibits <db> --gcal <db>");
    process.exit(1);
  }
  return resolve(v);
}

const dir = mkdtempSync(join(tmpdir(), "calendar-import-dry-"));
const calendarCopy = join(dir, "calendar.sqlite3");
copyFileSync(arg("calendar"), calendarCopy);
process.env.DB_PATH = join(dir, "capitol.sqlite3");
copyFileSync(arg("core"), process.env.DB_PATH);
process.env.EXHIBITS_DB_PATH = join(dir, "exhibits.sqlite3");
copyFileSync(arg("exhibits"), process.env.EXHIBITS_DB_PATH);
process.env.EXHIBIT_FILES_DIR = join(dir, "files");
process.env.CONNECTORS_DATA_DIR = join(dir, "connectors");
mkdirSync(process.env.CONNECTORS_DATA_DIR);
copyFileSync(arg("gcal"), join(process.env.CONNECTORS_DATA_DIR, "google-calendar.sqlite3"));

const { runMigrations } = await import("../../db/client.js");
const { startTypeEngine } = await import("../index.js");
const { refreshOwnerZone } = await import("../zone.js");
const { addConnector } = await import("../../connectors/runtime.js");
const { googleCalendar } = await import("../../connectors/googleCalendar/index.js");
const { runGcalMigrations } = await import("../../connectors/googleCalendar/db/client.js");
const { reconcile, startBindings } = await import("../bindings/runtime.js");
const { importLegacyCalendar } = await import("./calendarImport.js");
const { resolveLegacyAlias } = await import("../aliases.js");
const { getRecord, listRecords, manualRefs } = await import("../records.js");

runMigrations();
startTypeEngine();
await refreshOwnerZone();
runGcalMigrations();
addConnector(googleCalendar);
startBindings();

const before = listRecords("event", { limit: 500 }).length;
const stats = await importLegacyCalendar({ from: calendarCopy, sync: async () => reconcile("google-calendar") });
console.log("stats:", JSON.stringify(stats, null, 2));

// Every Chamber item, checked against what the import made of it.
const cal = new Database(calendarCopy, { readonly: true });
const cached = cal.prepare("SELECT id, title FROM cached_events").all() as { id: string; title: string }[];
const locals = cal.prepare("SELECT id, title FROM local_events").all() as { id: string; title: string }[];
const hidden = cal.prepare("SELECT exhibit_id FROM event_attendance WHERE not_attending = 1").all() as { exhibit_id: string }[];
const refs = cal.prepare("SELECT exhibit_id, target_exhibit_id FROM event_refs").all() as { exhibit_id: string; target_exhibit_id: string }[];
const selected = cal.prepare("SELECT account_id, google_calendar_id, summary FROM selected_calendars WHERE selected = 1").all();

const afterSync: string[] = [];
let mismatches = 0;
for (const e of cached) {
  const id = resolveLegacyAlias("calendar", e.id);
  if (!id) afterSync.push(e.title);
  else if (getRecord(id)?.values.title !== (e.title.trim() || "Untitled event") && e.title.trim() !== "") {
    mismatches++;
    console.log(`title differs: "${e.title}" vs "${getRecord(id)?.values.title}" (Google changed it since the Chamber's last sync?)`);
  }
}
for (const l of locals) {
  const id = resolveLegacyAlias("calendar", `event-0:local:${l.id}`);
  const rec = id ? getRecord(id) : null;
  if (!rec || rec.values.title !== (l.title.trim() || "Untitled event")) {
    mismatches++;
    console.log(`local event missing: ${l.title}`);
  } else console.log(`  local: ${l.title} -> ${rec.values.start} – ${rec.values.end}${rec.values.all_day ? " (all day)" : ""}`);
}
for (const h of hidden) {
  const id = resolveLegacyAlias("calendar", h.exhibit_id);
  if (id && getRecord(id)?.values.hidden !== true) {
    mismatches++;
    console.log(`not hidden: ${h.exhibit_id}`);
  }
}
for (const r of refs) {
  const id = resolveLegacyAlias("calendar", r.exhibit_id);
  if (id && manualRefs(id).length === 0) {
    mismatches++;
    console.log(`ref lost: ${r.exhibit_id} -> ${r.target_exhibit_id}`);
  }
}
console.log(`Chamber: ${selected.length} selected calendars, ${cached.length} cached events, ${locals.length} local, ${hidden.length} not attending, ${refs.length} links`);
console.log(`Events: ${before} before, ${listRecords("event", { limit: 500 }).length} after; ${afterSync.length} come with the first sync of the newly selected calendars`);
console.log(`${mismatches} mismatches. Scratch copies in ${dir}`);
process.exit(0);
