import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { buildChipToken, type Recurrence, type WatchEvent } from "@congress/shared-types";
import { db as defaultDb } from "../db/client.js";
import { aiTracking, exhibitCache, settings } from "../db/schema.js";
import { env } from "../env.js";
import { getAiSettings, updateAiSettings } from "./settings.js";
import { describeRecurrence, nextOccurrenceAfter } from "./recurrence.js";
import { serverTimeZone } from "./memory.js";

type AppDb = typeof defaultDb;

// One-time import of the retired Deputy Chamber's directives as tracked
// items. Self-disabling via settings.directivesImportedAt (set whether or
// not the file existed); a failure leaves it unset so the next boot retries.

interface DirectiveRow {
  id: number;
  title: string;
  body: string;
  enabled: number;
  schedule_type: "interval" | "daily" | "weekly" | "event" | null;
  interval_ms: number | null;
  schedule_hour: number | null;
  schedule_minute: number | null;
  schedule_day_of_week: number | null;
  schedule_time_zone: string | null;
  trigger_event_type: string | null;
  last_run_at: number | null;
  created_at: number;
}

export function directiveRecurrence(d: DirectiveRow): Recurrence | null {
  switch (d.schedule_type) {
    case "interval":
      return d.interval_ms ? { type: "interval", everyMinutes: Math.min(60 * 24 * 90, Math.max(5, Math.round(d.interval_ms / 60_000))) } : null;
    case "daily":
      return d.schedule_hour !== null && d.schedule_minute !== null ? { type: "daily", hour: d.schedule_hour, minute: d.schedule_minute } : null;
    case "weekly":
      return d.schedule_hour !== null && d.schedule_minute !== null && d.schedule_day_of_week !== null
        ? { type: "weekly", dayOfWeek: d.schedule_day_of_week, hour: d.schedule_hour, minute: d.schedule_minute }
        : null;
    default:
      return null;
  }
}

export async function importLegacyDirectives(opts: { db?: AppDb; deputyDbPath?: string; now?: Date } = {}): Promise<number | null> {
  const db = opts.db ?? defaultDb;
  const path = opts.deputyDbPath ?? env.LEGACY_DEPUTY_DB_PATH;
  const now = opts.now ?? new Date();
  if (db.select().from(settings).where(eq(settings.id, 1)).get()?.directivesImportedAt) return null;

  let imported = 0;
  try {
    if (existsSync(path)) {
      const source = new Database(path, { readonly: true, fileMustExist: true });
      try {
        const hasTable = source.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'directives'").get() !== undefined;
        if (hasTable) {
          const directives = source.prepare("SELECT * FROM directives ORDER BY id").all() as DirectiveRow[];
          const hasRefs = source.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'directive_refs'").get() !== undefined;
          const refsFor = (id: number): string[] => {
            if (!hasRefs) return [];
            const rows = source.prepare("SELECT target_exhibit_id AS target FROM directive_refs WHERE directive_id = ?").all(id) as { target: string }[];
            return rows.flatMap(({ target }) => {
              const cached = db.select().from(exhibitCache).where(eq(exhibitCache.id, target)).get();
              return cached && !cached.deleted ? [buildChipToken({ chamber: cached.chamber, id: target, name: cached.name })] : [];
            });
          };

          // The directives' own zone becomes the owner's zone if none is set.
          const aiSettings = await getAiSettings();
          const directiveZone = directives.find((d) => d.schedule_time_zone)?.schedule_time_zone ?? null;
          if (!aiSettings.timeZone && directiveZone) await updateAiSettings({ timeZone: directiveZone });
          const zone = serverTimeZone(aiSettings.timeZone ?? directiveZone);

          db.transaction((tx) => {
            for (const d of directives) {
              const recurrence = directiveRecurrence(d);
              const watchEvents: WatchEvent[] = d.schedule_type === "event" && d.trigger_event_type ? [{ type: d.trigger_event_type, immediate: true }] : [];
              const how = recurrence ? `It ran ${describeRecurrence(recurrence)}.` : watchEvents.length ? `It ran whenever ${d.trigger_event_type} happened.` : "It only ran when started by hand.";
              const body = `${d.body.trim()}\n\n(Imported from a Deputy directive. ${how})`.trim();
              tx.insert(aiTracking)
                .values({
                  title: d.title,
                  body,
                  status: d.enabled ? "active" : "paused",
                  watchEventsJson: JSON.stringify(watchEvents),
                  recurrenceJson: recurrence ? JSON.stringify(recurrence) : null,
                  nextCheckAt: recurrence ? new Date(nextOccurrenceAfter(recurrence, now.getTime(), zone)) : null,
                  refsJson: JSON.stringify(refsFor(d.id)),
                  source: "directive",
                  lastCheckedAt: d.last_run_at ? new Date(d.last_run_at) : null,
                  createdAt: new Date(d.created_at),
                  updatedAt: now,
                })
                .run();
              imported++;
            }
          });
        }
      } finally {
        source.close();
      }
    }
  } catch (err) {
    console.warn(`Deputy directives import failed, will retry next boot: ${(err as Error).message}`);
    return null;
  }

  db.insert(settings)
    .values({ id: 1, directivesImportedAt: now })
    .onConflictDoUpdate({ target: settings.id, set: { directivesImportedAt: now } })
    .run();
  if (imported) console.log(`Imported ${imported} Deputy directive(s) as tracked items.`);
  return imported;
}
