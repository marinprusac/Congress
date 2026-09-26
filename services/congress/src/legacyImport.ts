import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { db as defaultDb } from "./db/client.js";
import { settings } from "./db/schema.js";
import { env } from "./env.js";

type AppDb = typeof defaultDb;

interface ImportResult {
  eventSettings: number;
  eventHistory: number;
  notifications: number;
  pushSubscriptions: number;
}

function openLegacy(path: string): Database.Database | null {
  if (!existsSync(path)) return null;
  return new Database(path, { readonly: true, fileMustExist: true });
}

function hasTable(source: Database.Database, table: string): boolean {
  return source.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;
}

// Copies every row of `table` from `source` into the same-named table of
// `target`, with INSERT OR IGNORE so a re-run (or a row that already exists
// under a unique index) is a no-op. `columns` are the table's shared
// columns, minus autoincrement ids - those are reassigned here.
function copyRows(
  source: Database.Database,
  target: Database.Database,
  table: string,
  columns: string[],
  keep: (row: Record<string, unknown>) => boolean = () => true
): number {
  if (!hasTable(source, table)) return 0;
  const present = new Set(
    (source.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as { name: string }[]).map((c) => c.name)
  );
  // A column the (older) legacy file lacks reads back as NULL - only the
  // nullable ones added later (event_history.actor, ...) can be missing.
  const select = columns.map((c) => (present.has(c) ? c : `NULL AS ${c}`)).join(", ");
  const rows = (source.prepare(`SELECT ${select} FROM ${table}`).all() as Record<string, unknown>[]).filter(keep);
  const insert = target.prepare(
    `INSERT OR IGNORE INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((c) => `@${c}`).join(", ")})`
  );
  let inserted = 0;
  for (const row of rows) inserted += insert.run(row).changes;
  return inserted;
}

// One-time import of the retired Logs Chamber's own SQLite file (event
// settings/history, notifications, push subscriptions) into Congress's own
// DB, now that Logs is a core Congress feature. (It used to import the
// retired Capitol Chamber's widget placements too; the widget canvas itself
// is gone.) Idempotent and self-disabling: settings.legacyImportedAt is set
// once it has run (whether or not the files existed), so it never fires
// again. The old files are opened read-only and never modified. A failure
// partway leaves the flag unset so the next boot retries - safe because
// every insert is INSERT OR IGNORE.
export function importLegacyChamberData(
  opts: { db?: AppDb; logsDbPath?: string } = {}
): ImportResult | null {
  const db = opts.db ?? defaultDb;
  const target = db.$client;
  const logsPath = opts.logsDbPath ?? env.LEGACY_LOGS_DB_PATH;

  const row = db.select().from(settings).where(eq(settings.id, 1)).get();
  if (row?.legacyImportedAt) return null;

  const result: ImportResult = { eventSettings: 0, eventHistory: 0, notifications: 0, pushSubscriptions: 0 };

  try {
    const logs = openLegacy(logsPath);
    try {
      target.transaction(() => {
        if (logs) {
          result.eventSettings = copyRows(logs, target, "event_settings", [
            "event_type",
            "chamber",
            "label",
            "description",
            "payload_fields_json",
            "record_to_history",
            "history_retention_ms",
            "notify",
            "notify_title_template",
            "notify_body_template",
            "notify_url_template",
            "notify_dedupe_key_template",
            "last_fired_at",
            "created_at",
            "updated_at",
          ]);
          result.eventHistory = copyRows(logs, target, "event_history", [
            "chamber",
            "type",
            "payload_json",
            "actor",
            "occurred_at",
            "expires_at",
          ]);
          result.notifications = copyRows(logs, target, "notifications", [
            "chamber",
            "dedupe_key",
            "title",
            "body",
            "chamber_url",
            "created_at",
            "read_at",
          ]);
          result.pushSubscriptions = copyRows(logs, target, "push_subscriptions", ["endpoint", "p256dh", "auth", "created_at"]);
        }
      })();
    } finally {
      logs?.close();
    }
  } catch (err) {
    console.warn(`Legacy Logs import failed, will retry next boot: ${(err as Error).message}`);
    return null;
  }

  const now = new Date();
  db.insert(settings)
    .values({ id: 1, legacyImportedAt: now })
    .onConflictDoUpdate({ target: settings.id, set: { legacyImportedAt: now } })
    .run();
  console.log(`Legacy Logs import: ${JSON.stringify(result)}`);
  return result;
}
