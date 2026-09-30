import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runGcalMigrations } from "./db/client.js";
import { attendeesOf, eventKey, getEventRow, listEventRows, sourceTime } from "./cache.js";
import { listCalendars, setSelected } from "./calendars.js";
import { ev, fakeGoogle, resetGcalCache } from "./fakeGoogle.js";
import { syncAll } from "./sync.js";
import { GoogleApiError, googleMessage } from "../googleApi.js";

beforeAll(() => runGcalMigrations());
beforeEach(() => resetGcalCache());

const key = (id: string, cal = "primary", acct = 1) => eventKey(acct, cal, id);

describe("google calendar sync", () => {
  it("selects the primary calendar once, then syncs fully and incrementally", async () => {
    const { state, ctx } = fakeGoogle();
    state.full["1/primary"] = [
      ev("a", { attendees: [{ email: "Ana@Example.com", displayName: "Ana" }, { email: "me@example.com", self: true, responseStatus: "accepted" }] }),
      ev("b"),
    ];
    const first = await syncAll(ctx);
    expect(first).toEqual({ changed: 2, error: null });
    expect(listCalendars(1).map((c) => [c.calendarId, c.selected])).toEqual([["primary", true], ["work", false]]);
    expect(attendeesOf(key("a")).map((a) => [a.email, a.displayName, a.self])).toEqual([
      ["ana@example.com", "Ana", false],
      ["me@example.com", null, true],
    ]);
    expect(state.changesSeen.map((c) => c.key)).toEqual([key("a"), key("b")]);

    state.changes["1/primary"] = [ev("a", { updated: "u2", title: "Renamed" }), ev("b", { status: "cancelled" })];
    state.calls = [];
    const second = await syncAll(ctx);
    expect(second.changed).toBe(1);
    expect(state.calls.find((c) => c.url.includes("/events"))!.url).toContain("syncToken=");
    expect(getEventRow(key("a"))!.title).toBe("Renamed");
    expect(getEventRow(key("b"))).toBeUndefined();
    expect(state.changesSeen.slice(2)).toEqual([
      { kind: "event", key: key("a"), deleted: false },
      { kind: "event", key: key("b"), deleted: true },
    ]);
  });

  it("skips unchanged events and prunes ones that left the window", async () => {
    const { state, ctx } = fakeGoogle();
    state.full["1/primary"] = [ev("a"), ev("far", { day: 10 })];
    await syncAll(ctx);
    state.changes["1/primary"] = [ev("a"), ev("far", { day: 400, updated: "u2" })];
    expect((await syncAll(ctx)).changed).toBe(0);
    expect(listEventRows().map((r) => r.eventId)).toEqual(["a"]);
    // Leaving the window isn't a delete: bound records outlive the cache.
    expect(state.changesSeen.some((c) => c.deleted)).toBe(false);
  });

  it("gives times as instants, all-day ones at midnight in the owner's zone", () => {
    expect(sourceTime("2026-10-01", true, "Europe/Zagreb")).toBe("2026-09-30T22:00:00.000Z");
    expect(sourceTime("2026-10-01T09:00:00+02:00", false)).toBe("2026-10-01T07:00:00.000Z");
    expect(sourceTime("", false)).toBeNull();
  });

  it("falls back to a full sync when the token expired", async () => {
    const { state, ctx } = fakeGoogle();
    state.full["1/primary"] = [ev("a")];
    await syncAll(ctx);
    state.expired.add("1/primary");
    state.full["1/primary"] = [ev("a"), ev("new")];
    expect(await syncAll(ctx)).toEqual({ changed: 1, error: null });
    expect(getEventRow(key("new"))).toBeDefined();
  });

  it("purges a deselected calendar and forgets a disconnected account", async () => {
    const { state, ctx } = fakeGoogle();
    state.full["1/primary"] = [ev("a")];
    state.full["1/work"] = [ev("w")];
    await syncAll(ctx);
    setSelected(ctx, 1, "work", true);
    await syncAll(ctx);
    expect(getEventRow(key("w", "work"))).toBeDefined();

    state.changesSeen = [];
    setSelected(ctx, 1, "work", false);
    expect(getEventRow(key("w", "work"))).toBeUndefined();
    expect(state.changesSeen).toEqual([{ kind: "event", key: key("w", "work"), deleted: true }]);

    state.accounts = [];
    await syncAll(ctx);
    expect(listEventRows()).toEqual([]);
    expect(state.changesSeen.slice(1)).toEqual([{ kind: "event", key: key("a"), deleted: true }]);
    expect(listCalendars(1)).toEqual([]);
  });

  it("keeps syncing other accounts when one fails", async () => {
    const { state, ctx } = fakeGoogle();
    state.accounts.push({ id: 2, label: "Work", email: "me@work.io", needsReconnect: false, scopes: [] }, { id: 3, label: "Old", email: "old@x.io", needsReconnect: true, scopes: [] });
    state.calendarList[2] = [{ id: "primary", summary: "Work", primary: true }];
    state.full["1/primary"] = [ev("a")];
    state.failing.add(2);
    const result = await syncAll(ctx);
    expect(result.changed).toBe(1);
    expect(result.error).toContain("Work: Google said 500: boom");
    expect(result.error).toContain("Old needs reconnecting");
  });

  it("reports one line when every calendar of an account fails the same way", async () => {
    const { state, ctx } = fakeGoogle();
    await syncAll(ctx);
    setSelected(ctx, 1, "work", true);
    state.full["1/primary"] = [];
    const fetch = ctx.google.fetch;
    ctx.google.fetch = async (id, url, init) => {
      if (url.includes("/events")) throw new GoogleApiError(401, JSON.stringify({ error: { code: 401, message: "Request had invalid authentication credentials. Expected OAuth 2 access token." } }));
      return fetch(id, url, init);
    };
    expect((await syncAll(ctx)).error).toBe("Me: Google said 401: Request had invalid authentication credentials.");
  });
});

describe("googleMessage", () => {
  it("keeps Google's first sentence, or a short plain body", () => {
    expect(googleMessage(JSON.stringify({ error: { message: "Not Found. See docs." } }))).toBe("Not Found.");
    expect(googleMessage("boom")).toBe("boom");
    expect(googleMessage("x".repeat(300))).toHaveLength(118);
  });
});
