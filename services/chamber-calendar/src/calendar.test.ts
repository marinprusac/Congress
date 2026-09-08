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
vi.mock("./refs.js", () => ({ deleteManualRefsForEvent: vi.fn() }));
vi.mock("./events.js", () => ({ publishEvent: vi.fn() }));

import { db, runMigrations } from "./db/client.js";
import {
  createEvent as createGoogleEvent,
  getEvent as getGoogleEvent,
  syncEventExhibit,
} from "./google/events.js";
import { pushExhibitSync } from "./exhibits.js";
import { publishEvent } from "./events.js";
import {
  createEvent,
  getEvent,
  deleteEvent,
  InvalidEventRequestError,
  LocalEventNotFoundError,
} from "./calendar.js";
import { getLocalEvent } from "./localEvents.js";

beforeAll(() => {
  runMigrations(migrationsDir("chamber-calendar"));
});

beforeEach(() => {
  db.run("delete from local_events");
  db.run("delete from event_attendance");
  vi.mocked(createGoogleEvent).mockReset();
  vi.mocked(getGoogleEvent).mockReset();
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
