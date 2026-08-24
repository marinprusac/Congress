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
  description: z.string().nullable(),
  location: z.string().nullable(),
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

export const createEventRequestSchema = z.object({
  accountId: z.number().int(),
  calendarId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  location: z.string().optional(),
  allDay: z.boolean(),
  start: z.string(),
  end: z.string(),
  timeZone: z.string().min(1),
});
export type CreateEventRequest = z.infer<typeof createEventRequestSchema>;

export const updateEventRequestSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  allDay: z.boolean().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  timeZone: z.string().min(1).optional(),
});
export type UpdateEventRequest = z.infer<typeof updateEventRequestSchema>;

// notAttending:true on an invitation (see eventAttendanceSchema) declines the
// real Google invite (visible to the organizer/other guests, exactly like
// clicking "No" in Google Calendar); on any other event it just sets the
// local-only note. false reverses either one.
export const setEventAttendanceRequestSchema = z.object({ notAttending: z.boolean() });
export type SetEventAttendanceRequest = z.infer<typeof setEventAttendanceRequestSchema>;
