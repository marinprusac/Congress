import { Hono, type Context } from "hono";
import type { HttpBindings } from "@hono/node-server";
import {
  updateAccountRequestSchema,
  setCalendarSelectionRequestSchema,
  createEventRequestSchema,
  updateEventRequestSchema,
} from "./types.js";
import {
  mountManifestAndHealth,
  mountExhibitSearchRoutes,
  mountExhibitContentRoutes,
  mountManualRefsRoutes,
  mountStaticFrontend,
} from "@congress/chamber-kit";
import { calendarManifest } from "./manifest.js";
import { buildAuthUrl, exchangeCodeForTokens, decodeIdToken, createOAuthState, consumeOAuthState } from "./google/oauth.js";
import {
  listAccounts,
  updateAccountLabel,
  disconnectAccount,
  upsertAccountFromOAuth,
  AccountNeedsReconnectError,
} from "./google/accounts.js";
import { listGoogleCalendars, listSelectedCalendarsForUI, setCalendarSelection } from "./google/calendars.js";
import {
  listEvents,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent,
  getEventExhibitContent,
  updateEventExhibitContent,
  resyncEventExhibit,
  EventNotEditableError,
} from "./google/events.js";
import { GoogleApiError } from "./google/client.js";
import { searchEventExhibits, resolveEventExhibits } from "./exhibits.js";
import { listManualRefs, addManualRef, removeManualRef } from "./refs.js";
import { mcpApp } from "./mcp/server.js";

export const app = new Hono<{ Bindings: HttpBindings }>();

function mapError(c: Context, err: unknown): Response {
  if (err instanceof AccountNeedsReconnectError) {
    return c.json({ error: "account_needs_reconnect", accountId: err.accountId, label: err.label }, 409);
  }
  if (err instanceof EventNotEditableError) {
    return c.json({ error: "event_not_editable", message: err.message }, 403);
  }
  if (err instanceof GoogleApiError) {
    return c.json({ error: "google_api_error", status: err.status, message: err.message }, 502);
  }
  throw err;
}

mountManifestAndHealth(app, calendarManifest);

app.get("/api/accounts", (c) => c.json(listAccounts()));

app.patch("/api/accounts/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const body = await c.req.json().catch(() => null);
  const parsed = updateAccountRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  const account = updateAccountLabel(id, parsed.data.label);
  if (!account) return c.json({ error: "not_found" }, 404);
  return c.json(account);
});

app.delete("/api/accounts/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const deleted = await disconnectAccount(id);
  if (!deleted) return c.json({ error: "not_found" }, 404);
  return c.body(null, 204);
});

app.get("/api/oauth/google/start", (c) => {
  const state = createOAuthState();
  return c.redirect(buildAuthUrl(state));
});

app.get("/api/oauth/google/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state || !consumeOAuthState(state)) {
    return c.json({ error: "invalid_oauth_callback" }, 400);
  }
  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.idToken) return c.json({ error: "missing_id_token" }, 502);
    const { sub, email } = decodeIdToken(tokens.idToken);
    upsertAccountFromOAuth({
      sub,
      email,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      scope: tokens.scope,
      expiryMs: tokens.expiryMs,
    });
    return c.redirect("/calendar/settings?connected=1");
  } catch (err) {
    console.error("OAuth callback failed:", err);
    return c.json({ error: "oauth_failed" }, 502);
  }
});

app.get("/api/calendars/available", async (c) => {
  const accountId = Number(c.req.query("accountId"));
  if (!Number.isInteger(accountId)) return c.json({ error: "invalid_account_id" }, 400);
  try {
    return c.json(await listGoogleCalendars(accountId));
  } catch (err) {
    return mapError(c, err);
  }
});

app.get("/api/calendars/selected", (c) => c.json(listSelectedCalendarsForUI()));

app.put("/api/calendars/:accountId/:googleCalendarId/selection", async (c) => {
  const accountId = Number(c.req.param("accountId"));
  const googleCalendarId = decodeURIComponent(c.req.param("googleCalendarId"));
  if (!Number.isInteger(accountId)) return c.json({ error: "invalid_account_id" }, 400);
  const body = await c.req.json().catch(() => null);
  const parsed = setCalendarSelectionRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  setCalendarSelection(accountId, googleCalendarId, parsed.data.summary, parsed.data.colorHex, parsed.data.selected);
  return c.json({ ok: true });
});

app.get("/api/events", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (!from || !to) return c.json({ error: "missing_range" }, 400);
  return c.json(await listEvents(from, to));
});

app.get("/api/events/:accountId/:calendarId/:eventId", async (c) => {
  const accountId = Number(c.req.param("accountId"));
  const calendarId = decodeURIComponent(c.req.param("calendarId"));
  const eventId = decodeURIComponent(c.req.param("eventId"));
  if (!Number.isInteger(accountId)) return c.json({ error: "invalid_account_id" }, 400);
  try {
    return c.json(await getEvent(accountId, calendarId, eventId));
  } catch (err) {
    return mapError(c, err);
  }
});

app.post("/api/events", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createEventRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  try {
    return c.json(await createEvent(parsed.data), 201);
  } catch (err) {
    return mapError(c, err);
  }
});

app.patch("/api/events/:accountId/:calendarId/:eventId", async (c) => {
  const accountId = Number(c.req.param("accountId"));
  const calendarId = decodeURIComponent(c.req.param("calendarId"));
  const eventId = decodeURIComponent(c.req.param("eventId"));
  if (!Number.isInteger(accountId)) return c.json({ error: "invalid_account_id" }, 400);
  const body = await c.req.json().catch(() => null);
  const parsed = updateEventRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  try {
    return c.json(await updateEvent(accountId, calendarId, eventId, parsed.data));
  } catch (err) {
    return mapError(c, err);
  }
});

app.delete("/api/events/:accountId/:calendarId/:eventId", async (c) => {
  const accountId = Number(c.req.param("accountId"));
  const calendarId = decodeURIComponent(c.req.param("calendarId"));
  const eventId = decodeURIComponent(c.req.param("eventId"));
  if (!Number.isInteger(accountId)) return c.json({ error: "invalid_account_id" }, 400);
  try {
    await deleteEvent(accountId, calendarId, eventId);
    return c.body(null, 204);
  } catch (err) {
    return mapError(c, err);
  }
});

mountExhibitSearchRoutes(app, { search: searchEventExhibits, resolve: resolveEventExhibits });

mountExhibitContentRoutes(app, { getContent: getEventExhibitContent, updateContent: updateEventExhibitContent });

mountManualRefsRoutes(app, { list: listManualRefs, add: addManualRef, remove: removeManualRef }, resyncEventExhibit);

app.route("/mcp", mcpApp);

mountStaticFrontend(app);
