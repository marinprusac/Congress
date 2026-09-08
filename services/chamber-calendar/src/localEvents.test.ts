import { migrationsDir } from "@congress/test-support";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, runMigrations } from "./db/client.js";
import { localEvents } from "./db/schema.js";
import { setLocalNotAttending } from "./attendance.js";
import { LOCAL_ACCOUNT_ID, LOCAL_CALENDAR_ID, toExhibitId } from "./google/eventId.js";
import {
  listLocalEvents,
  searchLocalEvents,
  getLocalEvent,
  insertLocalEvent,
  updateLocalEventRow,
  deleteLocalEventRow,
  LocalEventNotFoundError,
} from "./localEvents.js";

beforeAll(() => {
  runMigrations(migrationsDir("chamber-calendar"));
});

beforeEach(() => {
  db.run("delete from local_events");
  db.run("delete from event_attendance");
});

describe("insertLocalEvent", () => {
  it("addresses the new row under the reserved local account/calendar pair, not a real Google one", async () => {
    const event = await insertLocalEvent("evt-1", {
      title: "Dentist",
      allDay: false,
      start: "2026-03-01T09:00",
      end: "2026-03-01T09:30",
    });

    expect(event.accountId).toBe(LOCAL_ACCOUNT_ID);
    expect(event.calendarId).toBe(LOCAL_CALENDAR_ID);
    expect(event.calendarSummary).toBe("Local");
    expect(event.htmlLink).toBeNull();
    expect(event.editable).toBe(true);
    // <input type="datetime-local"> values ("...T09:00") always gain
    // seconds, same normalization a Google event's own start/end gets - but
    // never an offset, since nothing external ever re-reads this value in a
    // different timezone (see this module's own header comment).
    expect(event.start).toBe("2026-03-01T09:00:00");
  });

  it("stores the plain projection of descriptionRich, not the raw token syntax, alongside the rich value itself", async () => {
    const event = await insertLocalEvent("evt-2", {
      title: "Coffee",
      descriptionRich: "Meet at [[exhibit:map:place-4|Cafe Roma]]",
      allDay: false,
      start: "2026-03-01T09:00",
      end: "2026-03-01T09:30",
    });

    expect(event.descriptionRich).toBe("Meet at [[exhibit:map:place-4|Cafe Roma]]");
    // Congress isn't reachable in this test environment, so the label
    // resolver falls back to each token's own embedded alias - "Cafe Roma"
    // here - rather than a live-looked-up name; either way the projected
    // plain text must never contain raw "[[exhibit:...]]" syntax.
    expect(event.description).toBe("Meet at Cafe Roma");
  });
});

describe("updateLocalEventRow", () => {
  it("only overwrites fields the request actually touched, leaving the rest as previously stored", async () => {
    await insertLocalEvent("evt-3", {
      title: "Standup",
      location: "Room 4",
      allDay: false,
      start: "2026-03-01T09:00",
      end: "2026-03-01T09:15",
    });

    const updated = await updateLocalEventRow("evt-3", { title: "Standup (moved)" });

    expect(updated.title).toBe("Standup (moved)");
    expect(updated.location).toBe("Room 4");
    expect(updated.start).toBe("2026-03-01T09:00:00");
  });

  it("throws LocalEventNotFoundError for an id with no row", async () => {
    await expect(updateLocalEventRow("missing", { title: "x" })).rejects.toThrow(LocalEventNotFoundError);
  });
});

describe("deleteLocalEventRow", () => {
  it("returns the deleted event's own snapshot and removes the row", async () => {
    await insertLocalEvent("evt-4", { title: "Gone soon", allDay: false, start: "2026-03-01T09:00", end: "2026-03-01T09:30" });

    const deleted = deleteLocalEventRow("evt-4");
    expect(deleted.title).toBe("Gone soon");
    expect(getLocalEvent("evt-4")).toBeUndefined();
  });

  it("throws LocalEventNotFoundError for an id with no row", () => {
    expect(() => deleteLocalEventRow("missing")).toThrow(LocalEventNotFoundError);
  });
});

describe("listLocalEvents", () => {
  it("excludes an event marked not-attending, same as the Agenda's own Google-backed filtering", async () => {
    const event = await insertLocalEvent("evt-5", { title: "Skip me", allDay: false, start: "2026-03-01T09:00", end: "2026-03-01T09:30" });
    setLocalNotAttending(toExhibitId(LOCAL_ACCOUNT_ID, LOCAL_CALENDAR_ID, event.id), true);

    const results = listLocalEvents("2026-03-01T00:00:00", "2026-03-02T00:00:00");
    expect(results).toHaveLength(0);
  });

  it("only returns events whose start falls within the requested range", async () => {
    await insertLocalEvent("evt-6", { title: "In range", allDay: false, start: "2026-03-01T09:00", end: "2026-03-01T09:30" });
    await insertLocalEvent("evt-7", { title: "Out of range", allDay: false, start: "2026-04-01T09:00", end: "2026-04-01T09:30" });

    const results = listLocalEvents("2026-03-01T00:00:00", "2026-03-02T00:00:00");
    expect(results.map((e) => e.title)).toEqual(["In range"]);
  });
});

describe("searchLocalEvents", () => {
  it("ranks an event titled exactly the query above one that only matches in its description", async () => {
    await insertLocalEvent("evt-8", {
      title: "Unrelated errand",
      description: "Discuss the ESN rollout with the team",
      allDay: false,
      start: "2026-03-01T10:00",
      end: "2026-03-01T10:30",
    });
    await insertLocalEvent("evt-9", { title: "ESN", allDay: false, start: "2026-03-05T10:00", end: "2026-03-05T10:30" });

    const results = searchLocalEvents("ESN");
    expect(results.map((e) => e.title)).toEqual(["ESN", "Unrelated errand"]);
  });
});
