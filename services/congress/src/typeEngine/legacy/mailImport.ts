import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { eq, like } from "drizzle-orm";
import { db } from "../../db/client.js";
import { exhibitCache, exhibitRefs } from "../../db/schema.js";
import { readChamberEnv } from "../../chambers/loader.js";
import { forgetChamber } from "../../registry.js";
import { exhibitsDb, exhibitsSqlite } from "../db/client.js";
import { imports, recordRefs } from "../db/schema.js";
import { getTypeByPremadeKey, type StoredType } from "../store.js";
import { syncRecordExhibit } from "../records.js";
import { addLegacyAlias, aliasesForIds } from "../aliases.js";
import { quoteIdent } from "../ddl.js";
import { bindingId } from "../operations.js";
import { materialize } from "../bindings/runtime.js";
import { skipPeople, unlinkedSentTo, updateSettings } from "../../connectors/gmail/cache.js";
import { listRecords, updateRecord } from "../records.js";

// One-time cutover of the Mail Chamber into Email records, read-only on its
// DB. Threads already exist (bound); this adds what only the Chamber knew and
// turns on what the Chamber did. Delete once it has run in production.

const KEY = "mail-v1";
const CHAMBER = "mail";
const MAIL_DIR = fileURLToPath(new URL("../../../../chamber-mail", import.meta.url));
const LEGACY = /^thread-(\d+):([A-Za-z0-9]+)$/;

export function defaultMailDbPath(): string {
  const configured = readChamberEnv(MAIL_DIR).DB_PATH ?? "./data/mail.sqlite3";
  return isAbsolute(configured) ? configured : resolve(MAIL_DIR, configured);
}

export interface MailImportStats {
  skipped?: "already_ran" | "no_source" | "no_type";
  aliases: number;
  fetched: number;
  missing: string[];
  // Threads the Chamber cached (up to 90 days) beyond the connector's 30-day sync.
  olderFetched: number;
  olderMissing: number;
  refs: number;
  exhibitRefsRewritten: number;
  includeAllCategories: boolean;
  feedWindowHours: number;
  // People the owner wrote to before the cutover: added to a Person of the same name, else never created.
  peopleLinkedByName: number;
  peopleSkipped: number;
}

export interface MailImportOptions {
  from?: string;
  // Pulls an old thread into a record (default: fetch it live from Gmail).
  fetchThread?: (t: StoredType, key: string) => Promise<string | null>;
}

export async function importLegacyMail(opts: MailImportOptions = {}): Promise<MailImportStats> {
  const stats: MailImportStats = { aliases: 0, fetched: 0, missing: [], olderFetched: 0, olderMissing: 0, refs: 0, exhibitRefsRewritten: 0, includeAllCategories: false, feedWindowHours: 24, peopleLinkedByName: 0, peopleSkipped: 0 };
  if (exhibitsDb.select().from(imports).where(eq(imports.key, KEY)).get()) return { ...stats, skipped: "already_ran" };
  const from = opts.from ?? defaultMailDbPath();
  if (!existsSync(from)) return { ...stats, skipped: "no_source" };
  const type = getTypeByPremadeKey("email");
  if (!type) return { ...stats, skipped: "no_type" };
  const binding = type.definition.bindings.find((b) => b.id === bindingId("gmail", "thread"));
  if (!binding) return { ...stats, skipped: "no_type" };

  const source = new Database(from, { readonly: true, fileMustExist: true });
  const refs = source.prepare("SELECT exhibit_id, target_exhibit_id FROM thread_refs ORDER BY id").all() as { exhibit_id: string; target_exhibit_id: string }[];
  const cached = source.prepare("SELECT DISTINCT account_id a, thread_id t FROM messages").all() as { a: number; t: string }[];
  const settingsRow = source.prepare("SELECT include_all_categories, feed_window_hours FROM settings WHERE id = 1").get() as
    | { include_all_categories: number; feed_window_hours: number }
    | undefined;
  source.close();
  stats.includeAllCategories = settingsRow?.include_all_categories === 1;
  stats.feedWindowHours = settingsRow?.feed_window_hours ?? 24;

  // 1. Every thread already a record: its old id ("thread-" + the key).
  const idFor = new Map<string, string>();
  const bound = exhibitsSqlite
    .prepare(`SELECT "id", "source_key" FROM ${quoteIdent(type.definition.tableName)} WHERE "source_binding" = ?`)
    .all(binding.id) as { id: string; source_key: string }[];
  for (const r of bound) idFor.set(`thread-${r.source_key}`, r.id);

  // 2. Older threads something links to: fetched from Gmail, then kept.
  const linked = new Set<string>([
    ...refs.flatMap((r) => [r.exhibit_id, r.target_exhibit_id]),
    ...db.select({ id: exhibitRefs.targetId }).from(exhibitRefs).where(like(exhibitRefs.targetId, "thread-%")).all().map((r) => r.id),
    ...db.select({ id: exhibitRefs.sourceId }).from(exhibitRefs).where(eq(exhibitRefs.sourceChamber, CHAMBER)).all().map((r) => r.id),
  ]);
  const fetchThread = opts.fetchThread ?? ((t: StoredType, key: string) => materialize(t, binding, key, { quiet: true }));
  for (const legacy of linked) {
    const m = legacy.match(LEGACY);
    if (!m || idFor.has(legacy)) continue;
    const id = await fetchThread(type, `${m[1]}:${m[2]}`).catch(() => null);
    if (id) {
      idFor.set(legacy, id);
      stats.fetched++;
    } else stats.missing.push(legacy);
  }
  // 3. The rest of what the Chamber kept, so search finds the same mail.
  for (const { a, t } of cached) {
    const legacy = `thread-${a}:${t}`;
    if (idFor.has(legacy)) continue;
    const id = await fetchThread(type, `${a}:${t}`).catch(() => null);
    if (id) {
      idFor.set(legacy, id);
      stats.olderFetched++;
    } else stats.olderMissing++;
  }

  exhibitsSqlite.transaction(() => {
    for (const [legacy, id] of idFor) {
      addLegacyAlias(CHAMBER, legacy, id);
      stats.aliases++;
    }
    // 4. Manual links from the Connections panel.
    for (const ref of refs) {
      const recordId = idFor.get(ref.exhibit_id);
      if (!recordId) continue;
      const target = idFor.get(ref.target_exhibit_id) ?? aliasesForIds([ref.target_exhibit_id]).get(ref.target_exhibit_id) ?? ref.target_exhibit_id;
      exhibitsDb.insert(recordRefs).values({ recordId, targetExhibitId: target, createdAt: new Date() }).onConflictDoNothing().run();
      stats.refs++;
    }
  })();

  // 5. Congress's DB: links to old ids and the Chamber's exhibit cache.
  db.transaction((tx) => {
    tx.delete(exhibitRefs).where(eq(exhibitRefs.sourceChamber, CHAMBER)).run();
    for (const [legacy, id] of idFor) {
      stats.exhibitRefsRewritten += tx.update(exhibitRefs).set({ targetId: id }).where(eq(exhibitRefs.targetId, legacy)).run().changes;
    }
    tx.delete(exhibitCache).where(eq(exhibitCache.chamber, CHAMBER)).run();
  });

  // 6. The owner reviewed who mail they sent would add: a same-named Person
  // gets the address, the rest are never created. New recipients from here on are.
  const people = listRecords("person", { limit: 5000 });
  const skip: string[] = [];
  for (const a of unlinkedSentTo()) {
    const name = a.name?.trim().toLowerCase();
    const same = name ? people.filter((p) => String(p.values.name ?? "").trim().toLowerCase() === name) : [];
    if (same.length === 1) {
      const emails = String(same[0]!.values.emails ?? "").trim();
      updateRecord(same[0]!.id, { emails: emails ? `${emails}\n${a.email}` : a.email }, { actor: "import" });
      stats.peopleLinkedByName++;
    } else skip.push(a.email);
  }
  skipPeople(skip);
  stats.peopleSkipped = skip.length;

  // 7. What the Chamber did, the connector does now: mail.received and People.
  updateSettings({ includeAllCategories: stats.includeAllCategories, publishEvents: true, createPeople: true });

  forgetChamber(CHAMBER);
  for (const id of new Set(idFor.values())) syncRecordExhibit(type, id);
  exhibitsDb.insert(imports).values({ key: KEY, ranAt: new Date(), statsJson: JSON.stringify(stats) }).onConflictDoNothing().run();
  return stats;
}
