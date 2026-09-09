import { migrationsDir } from "@congress/test-support";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./google/events.js", () => ({
  listEvents: vi.fn(async () => ({ events: [], accountErrors: [] })),
  searchEvents: vi.fn(async () => ({ events: [], accountErrors: [] })),
  getEvent: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
  setEventAttendance: vi.fn(),
  syncEventExhibit: vi.fn(),
}));
vi.mock("./exhibits.js", () => ({ pushExhibitSync: vi.fn() }));
vi.mock("./events.js", () => ({ publishEvent: vi.fn() }));

import { eq } from "drizzle-orm";
import { db, runMigrations } from "./db/client.js";
import { eventRefs } from "./db/schema.js";
import {
  createEvent as createGoogleEvent,
  getEvent as getGoogleEvent,
  deleteEvent as deleteGoogleEvent,
  syncEventExhibit,
} from "./google/events.js";
import { pushExhibitSync } from "./exhibits.js";
import { publishEvent } from "./events.js";
import {
  createEvent,
  getEvent,
  deleteEvent,
  moveEvent,
  InvalidEventRequestError,
  LocalEventNotFoundError,
} from "./calendar.js";
import { getLocalEvent } from "./localEvents.js";
import { setLocalNotAttending, getLocalNotAttending } from "./attendance.js";

// refs.js/attendance.js are used for real (not mocked) throughout this file
// - deleteManualRefsForEvent/moveManualRefs/moveLocalAttendance are plain db
// writes with no dependency on Google or Congress, and exercising them
// against the real event_refs/event_attendance tables is what actually
// proves a move carries them over correctly.
const googleEventFixture = {
  id: "g-1",
  accountId: 1,
  calendarId: "primary",
  calendarSummary: "Primary",
  calendarColor: null,
  title: "Meeting",
  description: null,
  location: null,
  descriptionRich: null,
  locationRich: null,
  allDay: false,
  start: "2026-03-01T09:00:00Z",
  end: "2026-03-01T09:30:00Z",
  htmlLink: null,
  editable: true,
  attendance: { isInvitation: false, responseStatus: null, notAttending: false },
};

beforeAll(() => {
  runMigrations(migrationsDir("chamber-calendar"));
});

beforeEach(() => {
  db.run("delete from local_events");
  db.run("delete from event_attendance");
  db.run("delete from event_refs");
  vi.mocked(createGoogleEvent).mockReset();
  vi.mocked(getGoogleEvent).mockReset();
  vi.mocked(deleteGoogleEvent).mockReset();
  vi.mocked(syncEventExhibit).mockReset();
  vi.mocked(pushExhibitSync).mockReset();
  vi.mocked(publishEvent).mockReset();
});

describe("createEvent", () => {
  it("creates a local event and syncs its exhibit when accountId/calendarId are both left out", async () => {
    const result = await createEvent({
      title: "Dentist",
      allDay: false,
      start: "2026-03-01T09:00",
      end: "2026-03-01T09:30",
    });

    expect(result.calendarId).toBe("local");
    expect(getLocalEvent(result.id)?.title).toBe("Dentist");
    expect(syncEventExhibit).toHaveBeenCalledWith(expect.objectContaining({ id: result.id, title: "Dentist" }));
    expect(publishEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "calendar.event_created" }));
    expect(createGoogleEvent).not.toHaveBeenCalled();
  });

  it("delegates to the Google implementation when both accountId and calendarId are present", async () => {
    vi.mocked(createGoogleEvent).mockResolvedValue({
      id: "g-1",
      accountId: 1,
      calendarId: "primary",
      calendarSummary: "Primary",
      calendarColor: null,
      title: "Meeting",
      description: null,
      location: null,
      descriptionRich: null,
      locationRich: null,
      allDay: false,
      start: "2026-03-01T09:00:00Z",
      end: "2026-03-01T09:30:00Z",
      htmlLink: null,
      editable: true,
      attendance: { isInvitation: false, responseStatus: null, notAttending: false },
    });

    const result = await createEvent({
      accountId: 1,
      calendarId: "primary",
      title: "Meeting",
      allDay: false,
      start: "2026-03-01T09:00",
      end: "2026-03-01T09:30",
      timeZone: "UTC",
    });

    expect(result.id).toBe("g-1");
    expect(createGoogleEvent).toHaveBeenCalledTimes(1);
  });

  it("rejects a request with exactly one of accountId/calendarId present", async () => {
    await expect(
      createEvent({ accountId: 1, title: "Bad", allDay: false, start: "2026-03-01T09:00", end: "2026-03-01T09:30" })
    ).rejects.toThrow(InvalidEventRequestError);
    expect(createGoogleEvent).not.toHaveBeenCalled();
  });
});

describe("getEvent", () => {
  it("resolves a local event without touching the Google implementation", async () => {
    const created = await createEvent({ title: "Local one", allDay: false, start: "2026-03-01T09:00", end: "2026-03-01T09:30" });

    const fetched = await getEvent(created.accountId, created.calendarId, created.id);
    expect(fetched.title).toBe("Local one");
    expect(getGoogleEvent).not.toHaveBeenCalled();
  });

  it("throws LocalEventNotFoundError for a local key with no matching row", async () => {
    await expect(getEvent(0, "local", "missing")).rejects.toThrow(LocalEventNotFoundError);
  });
});

describe("deleteEvent", () => {
  it("removes the row, pushes an exhibit tombstone, and publishes a deletion event", async () => {
    const created = await createEvent({ title: "To delete", allDay: false, start: "2026-03-01T09:00", end: "2026-03-01T09:30" });
    vi.mocked(publishEvent).mockClear();
    vi.mocked(pushExhibitSync).mockClear();

    await deleteEvent(created.accountId, created.calendarId, created.id);

    expect(getLocalEvent(created.id)).toBeUndefined();
    expect(pushExhibitSync).toHaveBeenCalledWith(expect.objectContaining({ deleted: true, name: "To delete" }));
    expect(publishEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "calendar.event_deleted" }));
  });
});

describe("moveEvent", () => {
  it("moves a local event onto a Google calendar, carrying its manual refs and dropping the local row", async () => {
    const created = await createEvent({ title: "Onsite", allDay: false, start: "2026-03-01T09:00", end: "2026-03-01T09:30" });
    const oldExhibitId = `event-${created.accountId}:local:${created.id}`;
    db.insert(eventRefs).values({ exhibitId: oldExhibitId, targetExhibitId: "note-1", createdAt: new Date() }).run();
    vi.mocked(createGoogleEvent).mockResolvedValue({ ...googleEventFixture, title: "Onsite" });

    const moved = await moveEvent(created.accountId, created.calendarId, created.id, {
      accountId: 1,
      calendarId: "primary",
      timeZone: "UTC",
    });

    expect(moved.id).toBe("g-1");
    expect(createGoogleEvent).toHaveBeenCalledWith(expect.objectContaining({ title: "Onsite", accountId: 1, calendarId: "primary" }));
    expect(getLocalEvent(created.id)).toBeUndefined();
    const newExhibitId = "event-1:primary:g-1";
    expect(db.select().from(eventRefs).where(eq(eventRefs.exhibitId, oldExhibitId)).all()).toHaveLength(0);
    const movedRefs = db.select().from(eventRefs).where(eq(eventRefs.exhibitId, newExhibitId)).all();
    expect(movedRefs).toHaveLength(1);
    expect(movedRefs[0]?.targetExhibitId).toBe("note-1");
  });

  it("moves a Google event onto local storage, carrying its not-attending note", async () => {
    vi.mocked(getGoogleEvent).mockResolvedValue({ ...googleEventFixture, title: "Offsite" });
    const oldExhibitId = "event-1:primary:g-1";
    setLocalNotAttending(oldExhibitId, true);

    const moved = await moveEvent(1, "primary", "g-1", {});

    expect(moved.calendarId).toBe("local");
    expect(getLocalEvent(moved.id)?.title).toBe("Offsite");
    expect(deleteGoogleEvent).toHaveBeenCalledWith(1, "primary", "g-1");
    expect(createGoogleEvent).not.toHaveBeenCalled();
    const newExhibitId = `event-${moved.accountId}:local:${moved.id}`;
    expect(getLocalNotAttending(oldExhibitId)).toBe(false);
    expect(getLocalNotAttending(newExhibitId)).toBe(true);
  });

  it("rejects moving an event this account doesn't organize", async () => {
    vi.mocked(getGoogleEvent).mockResolvedValue({ ...googleEventFixture, editable: false });

    await expect(moveEvent(1, "primary", "g-1", {})).rejects.toThrow(InvalidEventRequestError);
    expect(createGoogleEvent).not.toHaveBeenCalled();
    expect(deleteGoogleEvent).not.toHaveBeenCalled();
  });

  it("rejects moving an event onto the calendar it's already on", async () => {
    vi.mocked(getGoogleEvent).mockResolvedValue(googleEventFixture);

    await expect(moveEvent(1, "primary", "g-1", { accountId: 1, calendarId: "primary", timeZone: "UTC" })).rejects.toThrow(
      InvalidEventRequestError
    );

    const created = await createEvent({ title: "Already local", allDay: false, start: "2026-03-01T09:00", end: "2026-03-01T09:30" });
    await expect(moveEvent(created.accountId, created.calendarId, created.id, {})).rejects.toThrow(InvalidEventRequestError);
  });
});
