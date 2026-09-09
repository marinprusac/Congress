import { z } from "zod";

export const googleAccountSchema = z.object({
  id: z.number().int(),
  label: z.string(),
  email: z.string(),
  needsReconnect: z.boolean(),
  connectedAt: z.string(),
});
export type GoogleAccount = z.infer<typeof googleAccountSchema>;

export const updateAccountRequestSchema = z.object({
  label: z.string().min(1),
});
export type UpdateAccountRequest = z.infer<typeof updateAccountRequestSchema>;

export const googleCalendarListItemSchema = z.object({
  googleCalendarId: z.string(),
  summary: z.string(),
  backgroundColor: z.string().nullable(),
  primary: z.boolean(),
});
export type GoogleCalendarListItem = z.infer<typeof googleCalendarListItemSchema>;

export const selectedCalendarSchema = z.object({
  id: z.number().int(),
  accountId: z.number().int(),
  accountLabel: z.string(),
  googleCalendarId: z.string(),
  summary: z.string(),
  colorHex: z.string().nullable(),
  selected: z.boolean(),
});
export type SelectedCalendar = z.infer<typeof selectedCalendarSchema>;

export const setCalendarSelectionRequestSchema = z.object({
  summary: z.string().min(1),
  colorHex: z.string().nullable().optional(),
  selected: z.boolean(),
});
export type SetCalendarSelectionRequest = z.infer<typeof setCalendarSelectionRequestSchema>;

export const attendanceStatusSchema = z.enum(["needsAction", "declined", "tentative", "accepted"]);
export type AttendanceStatus = z.infer<typeof attendanceStatusSchema>;

// Describes this account's own RSVP standing on an event. isInvitation is
// true only when this account is a listed Google attendee who didn't
// organize the event - the case Google Calendar itself treats as something
// to accept/decline. There, responseStatus mirrors Google's own attendee
// responseStatus and notAttending is just a read of it. For every other
// event (this account organizes it, or isn't a listed attendee at all -
// there's no Google invite to respond to), responseStatus is always null and
// notAttending is a purely local, private note this Chamber stores on its
// own (see attendance.ts) - Google never learns about it.
export const eventAttendanceSchema = z.object({
  isInvitation: z.boolean(),
  responseStatus: attendanceStatusSchema.nullable(),
  notAttending: z.boolean(),
});
export type EventAttendance = z.infer<typeof eventAttendanceSchema>;

// start/end are ISO datetimes for timed events, or "YYYY-MM-DD" when allDay.
export const calendarEventSchema = z.object({
  id: z.string(),
  accountId: z.number().int(),
  calendarId: z.string(),
  calendarSummary: z.string(),
  calendarColor: z.string().nullable(),
  title: z.string(),
  // The plain, human-readable text actually stored on the Google event -
  // never contains raw "[[exhibit:...]]" token syntax. descriptionRich/
  // locationRich carry the chip-bearing value the editor loads/edits; null
  // there means this event predates the rich/plain split and has no
  // recorded rich value yet (falls back to the plain field verbatim).
  description: z.string().nullable(),
  location: z.string().nullable(),
  descriptionRich: z.string().nullable(),
  locationRich: z.string().nullable(),
  allDay: z.boolean(),
  start: z.string(),
  end: z.string(),
  htmlLink: z.string().url().nullable(),
  // False for events this account can't modify - e.g. an auto-added Gmail
  // reservation/reminder event whose organizer is a Google service, not the
  // account itself. Such an event can still be removed from the calendar
  // (deleteEvent), just not edited in place.
  editable: z.boolean(),
  attendance: eventAttendanceSchema,
});
export type CalendarEvent = z.infer<typeof calendarEventSchema>;

export const accountErrorSchema = z.object({
  accountId: z.number().int(),
  label: z.string(),
  reason: z.literal("needs_reconnect"),
});
export type AccountError = z.infer<typeof accountErrorSchema>;

export const listEventsResponseSchema = z.object({
  events: z.array(calendarEventSchema),
  accountErrors: z.array(accountErrorSchema),
});
export type ListEventsResponse = z.infer<typeof listEventsResponseSchema>;

// `description`/`location` stay plain-text inputs for API/MCP callers with
// no concept of exhibit chips (e.g. an Automation-triggered create_event
// tool call) - the value is used as both the rich and plain text verbatim,
// same as a rich value with no tokens in it. The web frontend instead
// populates `descriptionRich`/`locationRich` (the CM6 editor's authored
// text, tokens intact); when given, these take priority and the server
// derives the plain text actually sent to Google by resolving their tokens
// to current labels (see google/richTextMirror.ts).
//
// accountId/calendarId are both optional and travel together: present on
// both, this creates a real Google event on that account's calendar (and
// timeZone is then required, since Google needs it to interpret a timed
// start/end); absent on both, this creates an event stored only in this
// Chamber's own database instead (see localEvents.ts) - the New Event page's
// Calendar field simply leaves both out when nothing is selected, which is
// the default. Exactly one present is never valid (see calendar.ts's own
// createEvent, which is what actually enforces and dispatches on this).
export const createEventRequestSchema = z
  .object({
    accountId: z.number().int().optional(),
    calendarId: z.string().min(1).optional(),
    title: z.string().min(1),
    description: z.string().optional(),
    location: z.string().optional(),
    descriptionRich: z.string().optional(),
    locationRich: z.string().optional(),
    allDay: z.boolean(),
    start: z.string(),
    end: z.string(),
    timeZone: z.string().min(1).optional(),
  })
  .refine((v) => (v.accountId === undefined) === (v.calendarId === undefined), {
    message: "accountId and calendarId must both be provided (a Google event), or both left out (a local event).",
    path: ["calendarId"],
  })
  .refine((v) => v.accountId === undefined || v.timeZone !== undefined, {
    message: "timeZone is required when creating a Google event.",
    path: ["timeZone"],
  });
export type CreateEventRequest = z.infer<typeof createEventRequestSchema>;

export const updateEventRequestSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  descriptionRich: z.string().optional(),
  locationRich: z.string().optional(),
  allDay: z.boolean().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  timeZone: z.string().min(1).optional(),
});
export type UpdateEventRequest = z.infer<typeof updateEventRequestSchema>;

// Changes which store is the source of truth for an existing event - same
// accountId/calendarId/timeZone shape and "both or neither" rule as
// createEventRequestSchema, just without the content fields (the event's own
// title/description/etc. travel with it as-is; see calendar.ts's moveEvent).
// The event's id necessarily changes - ids are scoped to the calendar/account
// that stores the event, Google's included - so the caller follows up with
// the id the response reports rather than reusing the one just moved.
export const moveEventRequestSchema = z
  .object({
    accountId: z.number().int().optional(),
    calendarId: z.string().min(1).optional(),
    timeZone: z.string().min(1).optional(),
  })
  .refine((v) => (v.accountId === undefined) === (v.calendarId === undefined), {
    message: "accountId and calendarId must both be provided (a Google calendar), or both left out (local).",
    path: ["calendarId"],
  })
  .refine((v) => v.accountId === undefined || v.timeZone !== undefined, {
    message: "timeZone is required when moving an event onto a Google calendar.",
    path: ["timeZone"],
  });
export type MoveEventRequest = z.infer<typeof moveEventRequestSchema>;

// notAttending:true on an invitation (see eventAttendanceSchema) declines the
// real Google invite (visible to the organizer/other guests, exactly like
// clicking "No" in Google Calendar); on any other event it just sets the
// local-only note. false reverses either one.
export const setEventAttendanceRequestSchema = z.object({ notAttending: z.boolean() });
export type SetEventAttendanceRequest = z.infer<typeof setEventAttendanceRequestSchema>;
