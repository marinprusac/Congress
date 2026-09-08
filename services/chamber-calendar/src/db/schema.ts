import { sqliteTable, text, integer, index, unique, uniqueIndex } from "drizzle-orm/sqlite-core";

export const googleAccounts = sqliteTable("google_accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(),
  email: text("email").notNull(),
  googleSub: text("google_sub").notNull().unique(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  scope: text("scope").notNull(),
  tokenExpiry: integer("token_expiry", { mode: "timestamp_ms" }).notNull(),
  needsReconnect: integer("needs_reconnect", { mode: "boolean" }).notNull().default(false),
  connectedAt: integer("connected_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const selectedCalendars = sqliteTable(
  "selected_calendars",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: integer("account_id")
      .notNull()
      .references(() => googleAccounts.id, { onDelete: "cascade" }),
    googleCalendarId: text("google_calendar_id").notNull(),
    summary: text("summary").notNull(),
    colorHex: text("color_hex"),
    selected: integer("selected", { mode: "boolean" }).notNull().default(false),
    // Google's incremental-sync cursor (events.list `nextSyncToken`) - null
    // until the first full sync completes. See google/cache.ts's
    // syncOneCalendar: present, it drives a cheap incremental sync instead of
    // re-fetching the whole ~180-day window every cycle; cleared on a 410
    // Gone response, which forces the next cycle back to a full resync.
    syncToken: text("sync_token"),
  },
  (table) => [
    unique("selected_calendars_account_calendar_idx").on(table.accountId, table.googleCalendarId),
    index("selected_calendars_account_id_idx").on(table.accountId),
  ]
);

// Explicit references added from an event's "References" side panel, kept
// separate from the wikilinks parsed out of its description - see
// extractOutgoingExhibitRefs/syncEventExhibit in exhibits.ts/events.ts,
// which union both into the set actually pushed to Capitol. Unlike
// chamber-notes/src/db/schema.ts's noteRefs, keyed directly by the full
// Exhibit id string ("event-1:primary:abc123") rather than a local row id -
// an event has no local row of its own, it's fetched live from Google.
export const eventRefs = sqliteTable(
  "event_refs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    exhibitId: text("exhibit_id").notNull(),
    targetExhibitId: text("target_exhibit_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("event_refs_exhibit_target_idx").on(table.exhibitId, table.targetExhibitId)]
);

// A disposable, rebuildable local mirror of a bounded window of Google
// Calendar's own event data - Google stays the source of truth, this just
// avoids a live Google API round-trip on every read. Keyed by the same
// exhibit-id string exhibits.ts's toExhibitId() produces. googleUpdatedAt is
// Google's own "updated" timestamp - the cheap diff key google/cache.ts's
// poll-and-diff sync compares against to detect real changes (including
// ones made outside this Chamber, directly in Google Calendar).
export const cachedEvents = sqliteTable(
  "cached_events",
  {
    id: text("id").primaryKey(),
    accountId: integer("account_id")
      .notNull()
      .references(() => googleAccounts.id, { onDelete: "cascade" }),
    calendarId: text("calendar_id").notNull(),
    eventId: text("event_id").notNull(),
    calendarSummary: text("calendar_summary").notNull(),
    calendarColor: text("calendar_color"),
    title: text("title").notNull(),
    // The plain human-readable projection actually sent to/read from Google
    // - never contains raw "[[exhibit:...]]" token syntax. The *Rich
    // columns below hold the chip-bearing local value the editor loads and
    // edits; see google/richTextMirror.ts for how one derives the other.
    description: text("description"),
    location: text("location"),
    descriptionRich: text("description_rich"),
    locationRich: text("location_rich"),
    allDay: integer("all_day", { mode: "boolean" }).notNull(),
    start: text("start").notNull(),
    end: text("end").notNull(),
    htmlLink: text("html_link"),
    editable: integer("editable", { mode: "boolean" }).notNull(),
    // Google's own RSVP data for this account's attendee entry - see
    // attendance.ts's computeGoogleAttendance, which is what actually
    // derives these from the raw event's organizer/attendees. isInvitation
    // false means this account organizes the event (or isn't a listed
    // attendee), in which case responseStatus is always null and any "not
    // attending" note lives in eventAttendance below instead.
    isInvitation: integer("is_invitation", { mode: "boolean" }).notNull().default(false),
    attendeeResponseStatus: text("attendee_response_status"),
    googleUpdatedAt: text("google_updated_at").notNull(),
    syncedAt: integer("synced_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("cached_events_account_calendar_idx").on(table.accountId, table.calendarId),
    index("cached_events_start_idx").on(table.start),
  ]
);

// An event that lives only in this Chamber's own database - never sent to
// Google at all, unlike cachedEvents above (which mirrors an event Google
// itself stores). Created when the New Event page's Calendar field is left
// unselected (see google/eventId.ts's LOCAL_ACCOUNT_ID/LOCAL_CALENDAR_ID,
// the pseudo account/calendar identity a local row is addressed under so it
// can reuse the exact same exhibit-id/route shape a Google event has). Kept
// as its own small table rather than a nullable-accountId row bolted onto
// cachedEvents - that table is an explicitly disposable, rebuildable poll-
// sync mirror (see its own comment), and a local event has no such upstream
// to rebuild from were it ever wiped.
export const localEvents = sqliteTable(
  "local_events",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    // Same rich/plain split as cachedEvents' own description/location -
    // descriptionRich/locationRich carry the chip-bearing text the editor
    // loads/edits; description/location are the projected plain text (see
    // google/richTextMirror.ts's projectRichToPlain), kept alongside so
    // plain-text search (searchLocalEvents) doesn't need to strip tokens
    // out of the rich value on every query.
    description: text("description"),
    location: text("location"),
    descriptionRich: text("description_rich"),
    locationRich: text("location_rich"),
    allDay: integer("all_day", { mode: "boolean" }).notNull(),
    start: text("start").notNull(),
    end: text("end").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("local_events_start_idx").on(table.start)]
);

// A purely local, private "not attending" note for an event with no Google
// invite to respond to - this account either organizes it or isn't a listed
// attendee at all (see attendance.ts's resolveAttendance). Keyed by the same
// exhibit-id string as eventRefs, for the same reason: an event has no local
// row of its own to attach this to. Never touches Google - unlike declining
// a real invitation (handled by patching the event's own attendees via
// google/events.ts's setEventAttendance instead), nothing here is visible to
// the organizer or other guests.
export const eventAttendance = sqliteTable("event_attendance", {
  exhibitId: text("exhibit_id").primaryKey(),
  notAttending: integer("not_attending", { mode: "boolean" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
