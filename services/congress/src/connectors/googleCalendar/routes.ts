import { Hono } from "hono";
import { z } from "zod";
import type { ConnectorContext } from "../contract.js";
import { accountRows, fetchCalendarList, listCalendars, setSelected, storeCalendarList } from "./calendars.js";
import { cacheCounts, getSetting, setSetting } from "./cache.js";
import { friendlyError } from "./sync.js";

export const INTERVALS = [1, 5, 15, 30, 60] as const;
export const DEFAULT_INTERVAL = 5;

export function intervalMinutes(): number {
  const v = getSetting("intervalMinutes", DEFAULT_INTERVAL);
  return (INTERVALS as readonly number[]).includes(v) ? v : DEFAULT_INTERVAL;
}

function settingsDto() {
  return { intervalMinutes: intervalMinutes() };
}

const settingsInput = z.object({
  intervalMinutes: z.number().refine((v) => (INTERVALS as readonly number[]).includes(v)).optional(),
});

// The setup panel's API (Settings → Connectors).
export function calendarPanelRoutes(ctx: ConnectorContext): Hono {
  const app = new Hono();

  app.get("/status", (c) => {
    const rows = new Map(accountRows().map((r) => [r.accountId, r]));
    return c.json({
      accounts: ctx.google.accounts().map((a) => ({
        id: a.id,
        label: a.label,
        lastSyncedAt: rows.get(a.id)?.lastSyncedAt?.toISOString() ?? null,
        lastError: rows.get(a.id)?.lastError ?? null,
        calendars: listCalendars(a.id).map((cal) => ({ id: cal.calendarId, summary: cal.summary, color: cal.color, primary: cal.primary, selected: cal.selected })),
      })),
      counts: cacheCounts(),
      settings: settingsDto(),
    });
  });

  // Refreshes one account's calendar list from Google.
  app.post("/accounts/:id/calendars/refresh", async (c) => {
    const id = Number(c.req.param("id"));
    const account = ctx.google.accounts().find((a) => a.id === id);
    if (!account) return c.json({ error: "unknown account" }, 404);
    try {
      const seeded = accountRows().some((r) => r.accountId === id && r.seededAt);
      storeCalendarList(id, await fetchCalendarList(ctx, id), !seeded);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: friendlyError(err, account.label) }, 502);
    }
  });

  app.put("/accounts/:id/calendars/:calendarId", async (c) => {
    const body = z.object({ selected: z.boolean() }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "selected must be a boolean" }, 400);
    const ok = setSelected(ctx, Number(c.req.param("id")), c.req.param("calendarId"), body.data.selected);
    if (!ok) return c.json({ error: "unknown calendar" }, 404);
    if (body.data.selected) ctx.syncNow();
    return c.json({ ok: true });
  });

  app.get("/settings", (c) => c.json(settingsDto()));

  app.put("/settings", async (c) => {
    const body = settingsInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid settings" }, 400);
    if (body.data.intervalMinutes !== undefined) {
      setSetting("intervalMinutes", body.data.intervalMinutes);
      ctx.reschedule();
    }
    return c.json(settingsDto());
  });

  return app;
}
