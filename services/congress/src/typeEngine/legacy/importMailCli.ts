// Dry run of the Mail cutover against copies, never the live DBs:
//   pnpm --filter congress import:mail --mail <mail.sqlite3> --core <capitol.sqlite3>
//     --exhibits <exhibits.sqlite3> --gmail <gmail.sqlite3>
// Nothing reaches Gmail: older linked threads are reported, not fetched.
import { copyFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (!v) {
    console.error("usage: import:mail --mail <db> --core <db> --exhibits <db> --gmail <db>");
    process.exit(1);
  }
  return resolve(v);
}

const dir = mkdtempSync(join(tmpdir(), "mail-import-dry-"));
const mailCopy = join(dir, "mail.sqlite3");
copyFileSync(arg("mail"), mailCopy);
process.env.DB_PATH = join(dir, "capitol.sqlite3");
copyFileSync(arg("core"), process.env.DB_PATH);
process.env.EXHIBITS_DB_PATH = join(dir, "exhibits.sqlite3");
copyFileSync(arg("exhibits"), process.env.EXHIBITS_DB_PATH);
process.env.EXHIBIT_FILES_DIR = join(dir, "files");
process.env.CONNECTORS_DATA_DIR = join(dir, "connectors");
mkdirSync(process.env.CONNECTORS_DATA_DIR);
copyFileSync(arg("gmail"), join(process.env.CONNECTORS_DATA_DIR, "gmail.sqlite3"));

const { runMigrations } = await import("../../db/client.js");
const { startTypeEngine } = await import("../index.js");
const { runGmailMigrations, gmailDb } = await import("../../connectors/gmail/db/client.js");
const { threadAddresses } = await import("../../connectors/gmail/db/schema.js");
const { importLegacyMail } = await import("./mailImport.js");
const { resolveLegacyAlias } = await import("../aliases.js");
const { listRecords, manualRefs } = await import("../records.js");
const { getTypeBySlug } = await import("../store.js");
const { and, eq, isNull } = await import("drizzle-orm");

runMigrations();
startTypeEngine();
runGmailMigrations();

const stats = await importLegacyMail({ from: mailCopy, fetchThread: async () => null });
console.log("stats:", JSON.stringify(stats, null, 2));

const mail = new Database(mailCopy, { readonly: true });
const threads = mail.prepare("SELECT DISTINCT account_id a, thread_id t, subject FROM messages").all() as { a: number; t: string; subject: string }[];
const refs = mail.prepare("SELECT exhibit_id, target_exhibit_id FROM thread_refs").all() as { exhibit_id: string; target_exhibit_id: string }[];
let unmapped = 0;
for (const th of threads) if (!resolveLegacyAlias("mail", `thread-${th.a}:${th.t}`)) unmapped++;
let lost = 0;
for (const r of refs) {
  const id = resolveLegacyAlias("mail", r.exhibit_id);
  if (id && manualRefs(id).length === 0) {
    lost++;
    console.log(`ref lost: ${r.exhibit_id} -> ${r.target_exhibit_id}`);
  }
}
const people = gmailDb
  .selectDistinct({ email: threadAddresses.email, name: threadAddresses.name })
  .from(threadAddresses)
  .where(and(eq(threadAddresses.sentTo, true), isNull(threadAddresses.personId)))
  .all();
console.log(`Chamber: ${threads.length} cached threads (90 days), ${refs.length} links`);
console.log(`Emails: ${listRecords("email", { limit: 1000 }).length}, visible: ${!getTypeBySlug("email")?.definition.hidden}`);
console.log(`${unmapped} Chamber threads without an Email yet; ${stats.olderMissing} of them are fetched from Gmail at cutover (older than the 30-day sync)`);
console.log(`${stats.missing.length} linked threads to fetch from Gmail at cutover: ${stats.missing.join(", ") || "none"}`);
console.log(`People to create (To of mail you sent, no Person yet): ${people.length}`);
for (const p of people) console.log(`  ${p.name ? `${p.name} ` : ""}<${p.email}>`);
console.log(`${lost} links lost. Scratch copies in ${dir}`);
process.exit(0);
