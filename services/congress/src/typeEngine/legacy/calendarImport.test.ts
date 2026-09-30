import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { makeManifest, migrationsDir } from "@congress/test-support";
import { getChamber, registerChamber } from "../../registry.js";
import { db, runMigrations } from "../../db/client.js";
import { eventSettings, exhibitCache, exhibitRefs, settings } from "../../db/schema.js";
import { startTypeEngine } from "../index.js";
import { setOwnerZoneForTests } from "../zone.js";
import { createRecord, getRecord, manualRefs } from "../records.js";
import { resolveLegacyAlias } from "../aliases.js";
import { importLegacyCalendar, localInstant } from "./calendarImport.js";

const BINDING = { binding: "bnd_google-calendar_event", key: "1:me%40x.com:g1" };
let from = "";
let bound = "";

beforeAll(() => {
  runMigrations(migrationsDir("congress"));
  startTypeEngine();
  setOwnerZoneForTests("Europe/Zagreb");
  // The Google event, as the binding made it.
  bound = createRecord(
    "event",
    { title: "Standup", start: "2026-10-01T07:00:00.000Z", end: "2026-10-01T07:30:00.000Z", calendar: "1:me@x.com", description: "With Ana", location: "" },
    { source: BINDING, fromSource: true }
  ).id;

  from = join(mkdtempSync(join(tmpdir(), "cal-import-")), "calendar.sqlite3");
  const cal = new Database(from);
  cal.exec(`
    CREATE TABLE selected_calendars (account_id INTEGER, google_calendar_id TEXT, summary TEXT, selected INTEGER);
    CREATE TABLE cached_events (id TEXT, description TEXT, location TEXT, description_rich TEXT, location_rich TEXT);
    CREATE TABLE local_events (id TEXT, title TEXT, description TEXT, location TEXT, description_rich TEXT, location_rich TEXT, all_day INTEGER, start TEXT, end TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE event_attendance (exhibit_id TEXT, not_attending INTEGER);
    CREATE TABLE event_refs (id INTEGER PRIMARY KEY, exhibit_id TEXT, target_exhibit_id TEXT);
  `);
  cal.prepare("INSERT INTO selected_calendars VALUES (1, 'me@x.com', 'Me', 1)").run();
  cal.prepare("INSERT INTO cached_events VALUES (?, 'With Ana', '', 'With [[exhibit:e:01aaaaaaaaaaaaaaaaaaaaaaaa|Ana]]', NULL)").run(`event-${BINDING.key}`);
  const local = cal.prepare("INSERT INTO local_events VALUES (?, ?, '', '', NULL, NULL, ?, ?, ?, ?, ?)");
  local.run("u1", "Sleep", 0, "2026-09-08T22:08", "2026-09-09T07:56", 1_788_000_000_000, 1_788_000_000_000);
  local.run("u2", "Trip", 1, "2026-09-27", "2026-09-27", 1_788_000_001_000, 1_788_000_001_000);
  cal.prepare("INSERT INTO event_attendance VALUES (?, 1)").run(`event-${BINDING.key}`);
  cal.prepare("INSERT INTO event_attendance VALUES ('event-9:gone:x', 1)").run();
  cal.prepare("INSERT INTO event_refs (exhibit_id, target_exhibit_id) VALUES ('event-0:local:u1', ?)").run(`event-${BINDING.key}`);
  cal.close();

  registerChamber(makeManifest("calendar"));
  // Congress's side: a note linking the old event id, its cache row, a rule, a pin.
  db.insert(exhibitRefs).values({ sourceId: "note-1", sourceChamber: "notes", targetId: `event-${BINDING.key}` }).run();
  db.insert(exhibitCache).values({ id: `event-${BINDING.key}`, chamber: "calendar", type: "event", name: "Standup", url: "/e/x", updatedAt: new Date() }).run();
  const now = new Date();
  db.insert(eventSettings)
    .values({
      eventType: "calendar.event_starting_soon",
      chamber: "calendar",
      label: "Event starting soon",
      recordToHistory: true,
      notify: true,
      notifyTitleTemplate: "{{payload.title}} starts soon",
      notifyUrlTemplate: "{{payload.url}}",
      notifyDedupeKeyTemplate: "{{payload.dedupeKey}}",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(settings)
    .values({ id: 1, pinnedViews: [{ chamber: "calendar", viewId: "timeline" }, { chamber: "map", viewId: "today-map" }] })
    .onConflictDoUpdate({ target: settings.id, set: { pinnedViews: [{ chamber: "calendar", viewId: "timeline" }, { chamber: "map", viewId: "today-map" }] } })
    .run();
});

describe("the Calendar cutover", () => {
  it("reads a local event's stored time in the owner's zone", () => {
    expect(localInstant("2026-09-08T22:08", "Europe/Zagreb")).toBe("2026-09-08T20:08:00.000Z");
    expect(localInstant("2026-01-08T22:08", "Europe/Zagreb")).toBe("2026-01-08T21:08:00.000Z");
    expect(localInstant("nonsense", "Europe/Zagreb")).toBeNull();
  });

  it("carries over everything only the Chamber knew", async () => {
    let synced = 0;
    const stats = await importLegacyCalendar({ from, sync: async () => synced++ });
    expect(synced).toBe(1);
    expect(stats).toMatchObject({ googleAliases: 1, richApplied: 1, localEvents: 2, hidden: 1, hiddenMissing: 1, refs: 1, exhibitRefsRewritten: 1, pinnedRewritten: 1 });

    expect(resolveLegacyAlias("calendar", `event-${BINDING.key}`)).toBe(bound);
    expect(getRecord(bound)!.values).toMatchObject({ description: "With [[exhibit:e:01aaaaaaaaaaaaaaaaaaaaaaaa|Ana]]", hidden: true });

    const sleep = getRecord(resolveLegacyAlias("calendar", "event-0:local:u1")!)!;
    expect(sleep.values).toMatchObject({ title: "Sleep", start: "2026-09-08T20:08:00.000Z", end: "2026-09-09T05:56:00.000Z", calendar: "", all_day: false });
    expect(sleep.provenance).toBeNull();
    expect(manualRefs(sleep.id)).toEqual([bound]);
    // A one-day all-day event ends at the next midnight.
    const trip = getRecord(resolveLegacyAlias("calendar", "event-0:local:u2")!)!;
    expect(trip.values).toMatchObject({ all_day: true, start: "2026-09-26T22:00:00.000Z", end: "2026-09-27T22:00:00.000Z" });

    expect(db.select().from(exhibitRefs).where(eq(exhibitRefs.sourceId, "note-1")).get()!.targetId).toBe(bound);
    expect(db.select().from(exhibitCache).where(eq(exhibitCache.chamber, "calendar")).all()).toEqual([]);
    expect(db.select().from(eventSettings).where(eq(eventSettings.eventType, "event.starting_soon")).get()).toMatchObject({
      notify: true,
      notifyTitleTemplate: "{{payload.title}} starts soon",
      notifyDedupeKeyTemplate: "{{payload.recordId}}",
    });
    expect(getChamber("calendar")).toBeNull();
    expect(db.select().from(settings).get()!.pinnedViews).toEqual([{ chamber: "events", viewId: "timeline" }, { chamber: "map", viewId: "today-map" }]);
  });

  it("runs once", async () => {
    expect(await importLegacyCalendar({ from, sync: async () => undefined })).toMatchObject({ skipped: "already_ran" });
  });
});
