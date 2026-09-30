import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ConnectorRefusedError } from "../contract.js";
import { runGcalMigrations } from "./db/client.js";
import { eventKey, getEventRow } from "./cache.js";
import { ev, fakeGoogle, resetGcalCache } from "./fakeGoogle.js";
import { createEvent, deleteEvent, rsvp, toGoogleBody, updateEvent } from "./push.js";
import { syncAll } from "./sync.js";

beforeAll(() => runGcalMigrations());
beforeEach(() => resetGcalCache());

const EVENTS = "/calendar/v3/calendars/primary/events";

async function synced() {
  const g = fakeGoogle();
  g.state.full["1/primary"] = [
    ev("mine"),
    ev("invite", { organizerSelf: false, attendees: [{ email: "me@example.com", self: true, responseStatus: "needsAction" }, { email: "boss@example.com" }] }),
  ];
  await syncAll(g.ctx);
  g.state.calls = [];
  g.state.changesSeen = [];
  return g;
}

describe("google calendar push", () => {
  it("maps values to Google's body", () => {
    expect(toGoogleBody({ title: "T", allDay: true, start: "2026-10-01T00:00:00Z", end: "2026-10-02" })).toEqual({
      summary: "T",
      start: { date: "2026-10-01", dateTime: null },
      end: { date: "2026-10-02", dateTime: null },
    });
    expect(toGoogleBody({ start: "2026-10-01T09:00:00+02:00", end: "2026-10-01T10:00:00+02:00", timeZone: "Europe/Zagreb" }).start).toEqual({
      dateTime: "2026-10-01T09:00:00+02:00",
      date: null,
      timeZone: "Europe/Zagreb",
    });
    expect(() => toGoogleBody({ start: "" })).toThrow(ConnectorRefusedError);
  });

  it("creates on a synced calendar and writes through to the cache", async () => {
    const { state, ctx } = await synced();
    state.replies[`POST ${EVENTS}`] = ev("created", { title: "Lunch" });
    const record = await createEvent(ctx, { calendar: "1:primary", title: "Lunch", start: "2026-10-01T12:00:00Z", end: "2026-10-01T13:00:00Z" });
    expect(state.calls[0]).toMatchObject({ method: "POST", body: { summary: "Lunch" } });
    expect(state.calls[0]!.url).toContain("sendUpdates=none");
    expect(record).toMatchObject({ key: eventKey(1, "primary", "created"), values: { title: "Lunch" }, facts: { editable: true } });
    expect(state.changesSeen).toEqual([{ kind: "event", key: record.key, deleted: false }]);
    await expect(createEvent(ctx, { calendar: "1:work", title: "X", start: "a", end: "b" })).rejects.toThrow("isn't synced");
  });

  it("updates and deletes the owner's events but refuses invitations", async () => {
    const { state, ctx } = await synced();
    state.replies[`PATCH ${EVENTS}/mine`] = ev("mine", { title: "Moved", updated: "u2" });
    await updateEvent(ctx, eventKey(1, "primary", "mine"), { title: "Moved" });
    expect(state.calls[0]).toMatchObject({ method: "PATCH", body: { summary: "Moved" } });
    expect(getEventRow(eventKey(1, "primary", "mine"))!.title).toBe("Moved");

    await expect(updateEvent(ctx, eventKey(1, "primary", "invite"), { title: "No" })).rejects.toThrow(ConnectorRefusedError);
    await expect(deleteEvent(ctx, eventKey(1, "primary", "invite"))).rejects.toThrow(ConnectorRefusedError);

    state.replies[`DELETE ${EVENTS}/mine`] = null;
    await deleteEvent(ctx, eventKey(1, "primary", "mine"));
    expect(getEventRow(eventKey(1, "primary", "mine"))).toBeUndefined();
    expect(state.changesSeen.at(-1)).toEqual({ kind: "event", key: eventKey(1, "primary", "mine"), deleted: true });
  });

  it("answers invitations only", async () => {
    const { state, ctx } = await synced();
    const invite = ev("invite", { organizerSelf: false, attendees: [{ email: "me@example.com", self: true, responseStatus: "needsAction" }, { email: "boss@example.com" }] });
    state.replies[`GET ${EVENTS}/invite`] = invite;
    state.replies[`PATCH ${EVENTS}/invite`] = { ...invite, updated: "u2", attendees: [{ email: "me@example.com", self: true, responseStatus: "accepted" }, { email: "boss@example.com" }] };
    const record = await rsvp(ctx, eventKey(1, "primary", "invite"), "accepted");
    const patch = state.calls.find((c) => c.method === "PATCH")!;
    expect(patch.url).toContain("sendUpdates=all");
    expect(patch.body).toEqual({ attendees: [{ email: "me@example.com", self: true, responseStatus: "accepted" }, { email: "boss@example.com" }] });
    expect(record.facts.selfResponse).toBe("accepted");

    await expect(rsvp(ctx, eventKey(1, "primary", "invite"), "maybe")).rejects.toThrow(ConnectorRefusedError);
    state.replies[`GET ${EVENTS}/mine`] = ev("mine");
    await expect(rsvp(ctx, eventKey(1, "primary", "mine"), "declined")).rejects.toThrow("isn't an invitation");
  });
});
