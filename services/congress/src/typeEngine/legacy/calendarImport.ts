import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { eq, like } from "drizzle-orm";
import { db } from "../../db/client.js";
import { aiTracking, eventSettings, exhibitCache, exhibitRefs, settings } from "../../db/schema.js";
import { readChamberEnv } from "../../chambers/loader.js";
import { forgetChamber } from "../../registry.js";
import { exhibitsDb, exhibitsSqlite } from "../db/client.js";
import { imports, recordRefs } from "../db/schema.js";
import { getTypeByPremadeKey } from "../store.js";
import { createRecord, getRecord, syncRecordExhibit, updateRecord } from "../records.js";
import { addLegacyAlias, aliasesForIds } from "../aliases.js";
import { quoteIdent } from "../ddl.js";
import { bindingId } from "../operations.js";
import { ulid } from "../ulid.js";
import { addDays, DATE_PATTERN, ownerZone, startOfDay, wallTime } from "../zone.js";
import { runningConnector, syncConnector } from "../../connectors/registry.js";
import { listCalendars, setSelected } from "../../connectors/googleCalendar/calendars.js";

// One-time cutover of the Calendar Chamber into Event records, read-only on
// its DB. Google events already exist (bound); this adds what only the
// Chamber knew. Delete once it has run in production.

const KEY = "calendar-v1";
const CHAMBER = "calendar";
const CONNECTOR = "google-calendar";
const CAL_DIR = fileURLToPath(new URL("../../../../chamber-calendar", import.meta.url));

// The Chamber's events -> Event's, and payload fields renamed in templates.
const EVENT_NAMES: Record<string, string> = {
  "calendar.event_starting_soon": "event.starting_soon",
  "calendar.event_created": "event.created",
  "calendar.event_updated": "event.updated",
  "calendar.event_deleted": "event.deleted",
  "calendar.event_attendance_changed": "event.hidden",
};
const PAYLOAD_RENAMES: Record<string, string> = { eventId: "recordId", dedupeKey: "recordId" };

export function defaultCalendarDbPath(): string {
  const configured = readChamberEnv(CAL_DIR).DB_PATH ?? "./data/calendar.sqlite3";
  return isAbsolute(configured) ? configured : resolve(CAL_DIR, configured);
}

export interface CalendarImportStats {
  skipped?: "already_ran" | "no_source" | "no_type";
  calendarsSelected: number;
  calendarsMissing: string[];
  googleAliases: number;
  richApplied: number;
  richSkipped: number;
  localEvents: number;
  hidden: number;
  hiddenMissing: number;
  refs: number;
  refsMissing: number;
  exhibitRefsRewritten: number;
  eventSettingsCopied: string[];
  trackingUpdated: number;
  pinnedRewritten: number;
}

interface CachedRow {
  id: string;
  description: string | null;
  location: string | null;
  description_rich: string | null;
  location_rich: string | null;
}
interface LocalRow {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  description_rich: string | null;
  location_rich: string | null;
  all_day: number;
  start: string;
  end: string;
  created_at: number;
  updated_at: number;
}

// A local event's stored time ("YYYY-MM-DD" or "YYYY-MM-DDTHH:mm", no offset)
// read in the owner's zone.
export function localInstant(value: string, zone = ownerZone()): string | null {
  const [date, time] = value.split("T");
  if (!date || !DATE_PATTERN.test(date)) return null;
  const [h, m] = (time ?? "00:00").split(":").map(Number);
  const ms = wallTime(date, h ?? 0, m ?? 0, zone);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function localEventValues(row: LocalRow, zone = ownerZone()) {
  const allDay = row.all_day === 1;
  const start = localInstant(row.start, zone);
  let end = localInstant(row.end, zone);
  // An all-day end is exclusive; a same-day one means that single day.
  if (allDay && (!end || !start || end <= start)) end = new Date(startOfDay(addDays(row.start.slice(0, 10), 1), zone)).toISOString();
  return {
    title: row.title.trim() || "Untitled event",
    start,
    end,
    all_day: allDay,
    calendar: "",
    location: row.location_rich ?? row.location ?? "",
    description: row.description_rich ?? row.description ?? "",
  };
}

function rewriteTemplate(template: string | null): string | null {
  if (!template) return template;
  let out = template;
  for (const [from, to] of Object.entries(PAYLOAD_RENAMES)) out = out.replaceAll(`payload.${from}`, `payload.${to}`);
  return out;
}

export interface CalendarImportOptions {
  from?: string;
  // Syncs the connector (after the selection is copied) so every event exists.
  sync?: () => Promise<unknown>;
}

export async function importLegacyCalendar(opts: CalendarImportOptions = {}): Promise<CalendarImportStats> {
  const stats: CalendarImportStats = {
    calendarsSelected: 0,
    calendarsMissing: [],
    googleAliases: 0,
    richApplied: 0,
    richSkipped: 0,
    localEvents: 0,
    hidden: 0,
    hiddenMissing: 0,
    refs: 0,
    refsMissing: 0,
    exhibitRefsRewritten: 0,
    eventSettingsCopied: [],
    trackingUpdated: 0,
    pinnedRewritten: 0,
  };
  if (exhibitsDb.select().from(imports).where(eq(imports.key, KEY)).get()) return { ...stats, skipped: "already_ran" };
  const from = opts.from ?? defaultCalendarDbPath();
  if (!existsSync(from)) return { ...stats, skipped: "no_source" };
  const type = getTypeByPremadeKey("event");
  if (!type) return { ...stats, skipped: "no_type" };

  const source = new Database(from, { readonly: true, fileMustExist: true });
  const selected = source.prepare("SELECT account_id, google_calendar_id, summary FROM selected_calendars WHERE selected = 1").all() as {
    account_id: number;
    google_calendar_id: string;
    summary: string;
  }[];
  const cached = source.prepare("SELECT id, description, location, description_rich, location_rich FROM cached_events").all() as CachedRow[];
  const locals = source.prepare("SELECT * FROM local_events ORDER BY created_at").all() as LocalRow[];
  const attendance = source.prepare("SELECT exhibit_id FROM event_attendance WHERE not_attending = 1").all() as { exhibit_id: string }[];
  const refs = source.prepare("SELECT exhibit_id, target_exhibit_id FROM event_refs ORDER BY id").all() as { exhibit_id: string; target_exhibit_id: string }[];
  source.close();

  // 1. The Chamber's calendars, then a sync so all their events are records.
  const running = runningConnector(CONNECTOR);
  if (running) {
    for (const cal of selected) {
      const known = listCalendars(cal.account_id).find((c) => c.calendarId === cal.google_calendar_id);
      if (!known) {
        stats.calendarsMissing.push(cal.summary);
        continue;
      }
      if (!known.selected) setSelected(running.ctx, cal.account_id, cal.google_calendar_id, true);
      stats.calendarsSelected++;
    }
  }
  await (opts.sync ?? (() => syncConnector(CONNECTOR)))();

  // 2. Old exhibit ids of every Google event: "event-" + the connector's key.
  const binding = bindingId(CONNECTOR, "event");
  const idFor = new Map<string, string>();
  const bound = exhibitsSqlite
    .prepare(`SELECT "id", "source_key" FROM ${quoteIdent(type.definition.tableName)} WHERE "source_binding" = ?`)
    .all(binding) as { id: string; source_key: string }[];
  for (const r of bound) idFor.set(`event-${r.source_key}`, r.id);

  exhibitsSqlite.transaction(() => {
    for (const [legacy, id] of idFor) {
      addLegacyAlias(CHAMBER, legacy, id);
      stats.googleAliases++;
    }

    // 3. Chips in descriptions/locations, where Google's text still matches.
    for (const row of cached) {
      const id = idFor.get(row.id);
      const rec = id ? getRecord(id) : null;
      if (!id || !rec) continue;
      const patch: Record<string, string> = {};
      for (const [field, plain, rich] of [
        ["description", row.description, row.description_rich],
        ["location", row.location, row.location_rich],
      ] as const) {
        if (!rich || rich === plain) continue;
        if ((rec.values[field] ?? "") === (plain ?? "")) patch[field] = rich;
        else stats.richSkipped++;
      }
      if (Object.keys(patch).length) {
        updateRecord(id, patch, { fromSource: true, quiet: true, actor: "import" });
        stats.richApplied++;
      }
    }

    // 4. Events that only ever lived in the Chamber.
    for (const row of locals) {
      const id = ulid(row.created_at);
      createRecord("event", localEventValues(row), { id, at: new Date(row.created_at), updatedAt: new Date(row.updated_at), quiet: true, actor: "import" });
      idFor.set(`event-0:local:${encodeURIComponent(row.id)}`, id);
      addLegacyAlias(CHAMBER, `event-0:local:${encodeURIComponent(row.id)}`, id);
      stats.localEvents++;
    }

    // 5. "Not attending" was private: it becomes Hide, never a reply to Google.
    for (const a of attendance) {
      const id = idFor.get(a.exhibit_id);
      if (!id) {
        stats.hiddenMissing++;
        continue;
      }
      updateRecord(id, { hidden: true }, { fromSource: true, quiet: true, actor: "import" });
      stats.hidden++;
    }

    // 6. Manual links.
    for (const ref of refs) {
      const recordId = idFor.get(ref.exhibit_id);
      if (!recordId) {
        stats.refsMissing++;
        continue;
      }
      const target = idFor.get(ref.target_exhibit_id) ?? aliasesForIds([ref.target_exhibit_id]).get(ref.target_exhibit_id) ?? ref.target_exhibit_id;
      exhibitsDb.insert(recordRefs).values({ recordId, targetExhibitId: target, createdAt: new Date() }).onConflictDoNothing().run();
      stats.refs++;
    }
  })();

  // 7. Congress's DB: links to old ids, the old cache, event settings, watched events, pins.
  db.transaction((tx) => {
    tx.delete(exhibitRefs).where(eq(exhibitRefs.sourceChamber, CHAMBER)).run();
    for (const [legacy, id] of idFor) {
      stats.exhibitRefsRewritten += tx.update(exhibitRefs).set({ targetId: id }).where(eq(exhibitRefs.targetId, legacy)).run().changes;
    }
    tx.delete(exhibitCache).where(eq(exhibitCache.chamber, CHAMBER)).run();

    for (const row of tx.select().from(eventSettings).where(like(eventSettings.eventType, "calendar.%")).all()) {
      const target = EVENT_NAMES[row.eventType];
      if (!target) continue;
      const config = {
        recordToHistory: row.recordToHistory,
        historyRetentionMs: row.historyRetentionMs,
        notify: row.notify,
        notifyTitleTemplate: rewriteTemplate(row.notifyTitleTemplate),
        notifyBodyTemplate: rewriteTemplate(row.notifyBodyTemplate),
        notifyUrlTemplate: rewriteTemplate(row.notifyUrlTemplate),
        notifyDedupeKeyTemplate: rewriteTemplate(row.notifyDedupeKeyTemplate),
        updatedAt: new Date(),
      };
      const existing = tx.select().from(eventSettings).where(eq(eventSettings.eventType, target)).get();
      if (existing) tx.update(eventSettings).set(config).where(eq(eventSettings.eventType, target)).run();
      else tx.insert(eventSettings).values({ ...config, eventType: target, chamber: "types", label: row.label, createdAt: new Date() }).run();
      stats.eventSettingsCopied.push(`${row.eventType} → ${target}${row.notify ? " (notify)" : ""}`);
    }

    for (const item of tx.select().from(aiTracking).where(like(aiTracking.watchEventsJson, '%"calendar.%')).all()) {
      let json = item.watchEventsJson;
      for (const [old, next] of Object.entries(EVENT_NAMES)) json = json.replaceAll(`"${old}"`, `"${next}"`);
      tx.update(aiTracking).set({ watchEventsJson: json }).where(eq(aiTracking.id, item.id)).run();
      stats.trackingUpdated++;
    }

    const row = tx.select().from(settings).where(eq(settings.id, 1)).get();
    if (row?.pinnedViews.some((p) => p.chamber === CHAMBER)) {
      const pinned = row.pinnedViews.map((p) => (p.chamber === CHAMBER ? { chamber: "events", viewId: p.viewId } : p));
      stats.pinnedRewritten = row.pinnedViews.filter((p) => p.chamber === CHAMBER).length;
      tx.update(settings).set({ pinnedViews: pinned }).where(eq(settings.id, 1)).run();
    }
  });

  // The Chamber is retired: its registry row (views, icon) goes.
  forgetChamber(CHAMBER);
  for (const id of new Set(idFor.values())) syncRecordExhibit(type, id);
  exhibitsDb.insert(imports).values({ key: KEY, ranAt: new Date(), statsJson: JSON.stringify(stats) }).onConflictDoNothing().run();
  return stats;
}
