import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runGcalMigrations } from "./db/client.js";
import { eventKey, getEventRow } from "./cache.js";
import { ev, fakeGoogle, resetGcalCache } from "./fakeGoogle.js";
import { calendarPanelRoutes, intervalMinutes } from "./routes.js";
import { syncAll } from "./sync.js";

beforeAll(() => runGcalMigrations());
beforeEach(() => resetGcalCache());

const json = { "Content-Type": "application/json" };

describe("calendar panel routes", () => {
  it("report accounts, calendars and counts", async () => {
    const { state, ctx } = fakeGoogle();
    state.full["1/primary"] = [ev("a", { attendees: [{ email: "ana@x.io" }, { email: "me@example.com", self: true }] })];
    await syncAll(ctx);
    const body = await (await calendarPanelRoutes(ctx).request("/status")).json();
    expect(body).toMatchObject({
      accounts: [{ id: 1, label: "Me", lastError: null, calendars: [{ id: "primary", selected: true, primary: true }, { id: "work", selected: false }] }],
      counts: { events: 1, attendees: 1, people: 0 },
      settings: { intervalMinutes: 5 },
    });
  });

  it("select and deselect calendars", async () => {
    const { state, ctx } = fakeGoogle();
    ctx.syncNow = vi.fn();
    state.full["1/primary"] = [ev("a")];
    await syncAll(ctx);
    const routes = calendarPanelRoutes(ctx);
    const put = (cal: string, body: unknown) => routes.request(`/accounts/1/calendars/${encodeURIComponent(cal)}`, { method: "PUT", headers: json, body: JSON.stringify(body) });
    expect((await put("work", { selected: true })).status).toBe(200);
    expect(ctx.syncNow).toHaveBeenCalledTimes(1);
    expect((await put("primary", { selected: false })).status).toBe(200);
    expect(getEventRow(eventKey(1, "primary", "a"))).toBeUndefined();
    expect((await put("nope", { selected: true })).status).toBe(404);
    expect((await put("work", { selected: "yes" })).status).toBe(400);
  });

  it("refresh a calendar list, reporting Google errors", async () => {
    const { state, ctx } = fakeGoogle();
    const routes = calendarPanelRoutes(ctx);
    expect((await routes.request("/accounts/1/calendars/refresh", { method: "POST" })).status).toBe(200);
    const status = (await (await routes.request("/status")).json()) as { accounts: { calendars: { id: string; selected: boolean }[] }[] };
    expect(status.accounts[0]!.calendars.map((c) => [c.id, c.selected])).toEqual([["primary", true], ["work", false]]);
    state.failing.add(1);
    const failed = await routes.request("/accounts/1/calendars/refresh", { method: "POST" });
    expect(failed.status).toBe(502);
    expect((await routes.request("/accounts/9/calendars/refresh", { method: "POST" })).status).toBe(404);
  });

  it("save the interval", async () => {
    const { ctx } = fakeGoogle();
    ctx.reschedule = vi.fn();
    const routes = calendarPanelRoutes(ctx);
    const put = (body: unknown) => routes.request("/settings", { method: "PUT", headers: json, body: JSON.stringify(body) });
    expect(await (await put({ intervalMinutes: 15 })).json()).toEqual({ intervalMinutes: 15 });
    expect(intervalMinutes()).toBe(15);
    expect(ctx.reschedule).toHaveBeenCalled();
    expect((await put({ intervalMinutes: 7 })).status).toBe(400);
  });
});
