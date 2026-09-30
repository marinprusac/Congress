import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";

// The Google Calendar connector's cache: re-fetchable from Google, plus the
// owner's calendar choice and settings.

export const accounts = sqliteTable("accounts", {
  accountId: integer("account_id").primaryKey(),
  // Set once the account's calendars were first listed (primary selected).
  seededAt: integer("seeded_at", { mode: "timestamp_ms" }),
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }),
  lastError: text("last_error"),
});

export const calendars = sqliteTable(
  "calendars",
  {
    accountId: integer("account_id").notNull(),
    calendarId: text("calendar_id").notNull(),
    summary: text("summary").notNull().default(""),
    color: text("color"),
    accessRole: text("access_role"),
    primary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
    selected: integer("selected", { mode: "boolean" }).notNull().default(false),
    syncToken: text("sync_token"),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.calendarId] })]
);

export const events = sqliteTable(
  "events",
  {
    // <accountId>:<calendarId>:<eventId>, the source key.
    key: text("key").primaryKey(),
    accountId: integer("account_id").notNull(),
    calendarId: text("calendar_id").notNull(),
    eventId: text("event_id").notNull(),
    title: text("title").notNull().default(""),
    description: text("description").notNull().default(""),
    location: text("location").notNull().default(""),
    allDay: integer("all_day", { mode: "boolean" }).notNull(),
    // Google's own value: a date for all-day events, else an RFC3339 dateTime.
    start: text("start").notNull(),
    end: text("end").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    timeZone: text("time_zone"),
    htmlLink: text("html_link"),
    recurringEventId: text("recurring_event_id"),
    organizerEmail: text("organizer_email"),
    organizerSelf: integer("organizer_self", { mode: "boolean" }).notNull(),
    guestsCanModify: integer("guests_can_modify", { mode: "boolean" }).notNull(),
    selfResponse: text("self_response"),
    googleUpdated: text("google_updated"),
    syncedAt: integer("synced_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("events_calendar_idx").on(t.accountId, t.calendarId), index("events_start_idx").on(t.startMs)]
);

export const eventAttendees = sqliteTable(
  "event_attendees",
  {
    eventKey: text("event_key").notNull(),
    email: text("email").notNull(),
    displayName: text("display_name"),
    responseStatus: text("response_status"),
    organizer: integer("organizer", { mode: "boolean" }).notNull().default(false),
    self: integer("self", { mode: "boolean" }).notNull().default(false),
    resource: integer("resource", { mode: "boolean" }).notNull().default(false),
    optional: integer("optional", { mode: "boolean" }).notNull().default(false),
    // The existing Person with this email, once one exists.
    personId: text("person_id"),
  },
  (t) => [primaryKey({ columns: [t.eventKey, t.email] }), index("event_attendees_email_idx").on(t.email)]
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
