import { migrationsDir } from "@congress/test-support";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../exhibits.js", () => ({ pushExhibitSync: vi.fn() }));
vi.mock("../events.js", () => ({ publishEvent: vi.fn() }));
vi.mock("./client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./client.js")>()),
  googleCalendarFetch: vi.fn(),
}));

import { db, runMigrations } from "../db/client.js";
import { googleAccounts } from "../db/schema.js";
import { googleCalendarFetch } from "./client.js";
import { setEventAttendance } from "./events.js";

const fetchMock = vi.mocked(googleCalendarFetch);

beforeAll(() => {
  runMigrations(migrationsDir("chamber-calendar"));
  db.insert(googleAccounts)
    .values({
      id: 1,
      label: "Test",
      email: "me@example.com",
      googleSub: "sub-1",
      accessToken: "at",
      refreshToken: "rt",
      scope: "scope",
      tokenExpiry: new Date(),
      connectedAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
});

beforeEach(() => fetchMock.mockReset());

let nextId = 1;
function invitation(responseStatus: string) {
  return {
    id: `inv-${nextId++}`,
    summary: "Standup",
    start: { dateTime: "2026-10-01T10:00:00+02:00" },
    end: { dateTime: "2026-10-01T10:30:00+02:00" },
    organizer: { email: "boss@example.com" },
    attendees: [
      { email: "boss@example.com", responseStatus: "accepted" },
      { email: "me@example.com", self: true, responseStatus },
    ],
  };
}

function patchCalls() {
  return fetchMock.mock.calls.filter(([, , init]) => init?.method === "PATCH");
}

describe("setEventAttendance on a Google invitation", () => {
  it("declines locally only - never patches Google", async () => {
    const raw = invitation("needsAction");
    fetchMock.mockResolvedValueOnce(raw);

    const result = await setEventAttendance(1, "primary", raw.id, true);

    expect(patchCalls()).toHaveLength(0);
    expect(result.attendance).toEqual({ isInvitation: true, responseStatus: "declined", notAttending: true });
  });

  it("accepts via Google with sendUpdates and clears a prior local decline", async () => {
    const raw = invitation("needsAction");
    fetchMock.mockResolvedValueOnce(raw);
    await setEventAttendance(1, "primary", raw.id, true);

    const accepted = { ...raw, attendees: raw.attendees.map((a) => (a.self ? { ...a, responseStatus: "accepted" } : a)) };
    fetchMock.mockResolvedValueOnce(raw).mockResolvedValueOnce(accepted);
    const result = await setEventAttendance(1, "primary", raw.id, false);

    const patches = patchCalls();
    expect(patches).toHaveLength(1);
    expect(patches[0]![1]).toContain("sendUpdates=all");
    expect(JSON.parse(patches[0]![2]!.body as string).attendees).toContainEqual(
      expect.objectContaining({ self: true, responseStatus: "accepted" })
    );
    expect(result.attendance).toEqual({ isInvitation: true, responseStatus: "accepted", notAttending: false });
  });

  it("skips the Google patch when re-accepting an invite Google already has accepted", async () => {
    const raw = invitation("accepted");
    fetchMock.mockResolvedValueOnce(raw);
    await setEventAttendance(1, "primary", raw.id, true);

    fetchMock.mockResolvedValueOnce(raw);
    const result = await setEventAttendance(1, "primary", raw.id, false);

    expect(patchCalls()).toHaveLength(0);
    expect(result.attendance.notAttending).toBe(false);
  });
});
