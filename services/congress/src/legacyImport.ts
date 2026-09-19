import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { db as defaultDb } from "./db/client.js";
import { settings } from "./db/schema.js";
import { env } from "./env.js";

type AppDb = typeof defaultDb;

// Widgets from Chambers that no longer exist. "logs" contributed the old
// recent-logs/bell widgets, which were removed rather than carried over (the
// bell is Congress chrome now); "capitol" never had widgets of its own.
const RETIRED_WIDGET_CHAMBERS = new Set(["logs", "capitol"]);

interface ImportResult {
  layouts: number;
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

// One-time import of the retired Capitol and Logs Chambers' own SQLite files
// (widget placements; event settings/history, notifications, push
// subscriptions) into Congress's own DB, now that both are core Congress
// features. Idempotent and self-disabling: settings.legacyImportedAt is set
// once it has run (whether or not the files existed), so it never fires
// again. The old files are opened read-only and never modified. A failure
// partway leaves the flag unset so the next boot retries - safe because
// every insert is INSERT OR IGNORE.
export function importLegacyChamberData(
  opts: { db?: AppDb; capitolDbPath?: string; logsDbPath?: string } = {}
): ImportResult | null {
  const db = opts.db ?? defaultDb;
  const target = db.$client;
  const capitolPath = opts.capitolDbPath ?? env.LEGACY_CAPITOL_DB_PATH;
  const logsPath = opts.logsDbPath ?? env.LEGACY_LOGS_DB_PATH;

  const row = db.select().from(settings).where(eq(settings.id, 1)).get();
  if (row?.legacyImportedAt) return null;

  const result: ImportResult = { layouts: 0, eventSettings: 0, eventHistory: 0, notifications: 0, pushSubscriptions: 0 };

  try {
    const capitol = openLegacy(capitolPath);
    const logs = openLegacy(logsPath);
    try {
      target.transaction(() => {
        if (capitol) {
          result.layouts = copyRows(
            capitol,
            target,
            "widget_layouts",
            ["scope", "chamber", "widget_id", "x", "y", "updated_at"],
            (r) => !RETIRED_WIDGET_CHAMBERS.has(String(r.chamber))
          );
        }
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
      capitol?.close();
      logs?.close();
    }
  } catch (err) {
    console.warn(`Legacy Capitol/Logs import failed, will retry next boot: ${(err as Error).message}`);
    return null;
  }

  const now = new Date();
  db.insert(settings)
    .values({ id: 1, legacyImportedAt: now })
    .onConflictDoUpdate({ target: settings.id, set: { legacyImportedAt: now } })
    .run();
  console.log(`Legacy Capitol/Logs import: ${JSON.stringify(result)}`);
  return result;
}
