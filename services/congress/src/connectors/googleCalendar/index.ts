import { ConnectorRefusedError, defineConnector } from "../contract.js";
import { closeGcalDb, runGcalMigrations } from "./db/client.js";
import { forgetAccount, getEventRow, listEventRows, toSourceRecord } from "./cache.js";
import { writableCalendars } from "./calendars.js";
import { listGoogleAccounts } from "../google/accounts.js";
import { createEvent, deleteEvent, rsvp, updateEvent } from "./push.js";
import { calendarPanelRoutes, intervalMinutes } from "./routes.js";
import { syncAll } from "./sync.js";

export const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

const onlyEvents = (kind: string) => {
  if (kind !== "event") throw new ConnectorRefusedError(`no source kind "${kind}"`);
};

export const googleCalendar = defineConnector({
  name: "google-calendar",
  label: "Google Calendar",
  googleScopes: CALENDAR_SCOPES,
  source: [
    {
      kind: "event",
      label: "Event",
      fields: [
        { slug: "title", kind: "text", label: "Title" },
        { slug: "description", kind: "text", label: "Description" },
        { slug: "location", kind: "text", label: "Location" },
        { slug: "allDay", kind: "boolean", label: "All day" },
        { slug: "start", kind: "datetime", label: "Start" },
        { slug: "end", kind: "datetime", label: "End" },
        { slug: "htmlLink", kind: "text", label: "Google link" },
        { slug: "calendar", kind: "text", label: "Calendar" },
        { slug: "calendarLabel", kind: "text", label: "Calendar name" },
        { slug: "calendarColor", kind: "text", label: "Calendar color" },
        { slug: "response", kind: "enum", label: "Your response" },
        { slug: "attendees", kind: "text", label: "Guests", many: true },
        { slug: "people", kind: "relation", label: "People", many: true, target: "person" },
      ],
      keys: [{ field: "attendees", kind: "email" }],
      facts: [
        { slug: "editable", label: "Editable" },
        { slug: "isInvitation", label: "Invitation" },
        { slug: "canRsvp", label: "Can answer" },
        { slug: "selfResponse", label: "Your response" },
      ],
    },
  ],
  start: () => runGcalMigrations(),
  stop: () => closeGcalDb(),
  sync: (ctx) => syncAll(ctx),
  intervalMs: () => intervalMinutes() * 60_000,
  read: {
    get(kind, key) {
      onlyEvents(kind);
      const row = getEventRow(key);
      return row ? toSourceRecord(row) : null;
    },
    list(kind, opts) {
      onlyEvents(kind);
      return listEventRows(opts).map((row) => toSourceRecord(row));
    },
    targets(kind) {
      onlyEvents(kind);
      const accounts = new Map(listGoogleAccounts().map((a) => [a.id, a.label || a.email]));
      return writableCalendars().map((c) => ({ value: `${c.accountId}:${c.calendarId}`, label: c.summary, group: accounts.get(c.accountId) }));
    },
  },
  push: {
    create: (ctx, kind, values) => (onlyEvents(kind), createEvent(ctx, values)),
    update: (ctx, kind, key, patch) => (onlyEvents(kind), updateEvent(ctx, key, patch)),
    delete: (ctx, kind, key) => (onlyEvents(kind), deleteEvent(ctx, key)),
    act(ctx, kind, key, action, args) {
      onlyEvents(kind);
      if (action !== "rsvp") throw new ConnectorRefusedError(`no action "${action}"`);
      return rsvp(ctx, key, args.response);
    },
  },
  routes: (ctx) => calendarPanelRoutes(ctx),
  onEvent(ctx, event) {
    const accountId = (event.payload as { accountId?: unknown } | null)?.accountId;
    if (event.type === "google.account_disconnected" && typeof accountId === "number") {
      for (const key of forgetAccount(accountId)) ctx.emitChange("event", key, true);
    }
    if (event.type === "google.account_connected") ctx.syncNow();
  },
});
