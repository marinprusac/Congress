import type { Manifest } from "@congress/shared-types";
import { CALENDAR_SCOPES } from "./google/accounts.js";

export const calendarManifest: Manifest = {
  name: "calendar",
  displayName: "Calendar",
  version: "0.1.0",
  routes: {
    home: "/calendar",
    settings: "/calendar/settings",
  },
  // Views are only genuine screens (see shared-types' manifestViewSchema) -
  // this Chamber's exhibits reach the home feed and Search on their own.
  // exhibitTypes is what the home screen's "+" can create here.
  views: [
    { id: "timeline", label: "Timeline", description: "The coming days, as a list", fullPath: "/" },
    { id: "week", label: "Week", description: "This week on an hour grid", fullPath: "/week" },
  ],
  exhibitTypes: [{ type: "event", label: "Event", createPath: "/new" }],
  googleScopes: CALENDAR_SCOPES,
  events: [
    {
      type: "calendar.event_starting_soon",
      label: "Event starting soon",
      description: "A timed event on a connected calendar starts within 30 minutes.",
      payloadFields: {
        dedupeKey: { type: "string" },
        title: { type: "string" },
        minutesUntil: { type: "number" },
        url: { type: "string" },
      },
    },
    {
      type: "calendar.event_created",
      label: "Event created",
      description: "A new event was created on a connected calendar.",
      payloadFields: {
        accountId: { type: "number" },
        calendarId: { type: "string" },
        eventId: { type: "string" },
        title: { type: "string" },
        url: { type: "string" },
      },
    },
    {
      type: "calendar.event_updated",
      label: "Event updated",
      description: "An event on a connected calendar changed.",
      payloadFields: {
        accountId: { type: "number" },
        calendarId: { type: "string" },
        eventId: { type: "string" },
        title: { type: "string" },
        url: { type: "string" },
      },
    },
    {
      type: "calendar.event_deleted",
      label: "Event deleted",
      description: "An event on a connected calendar was deleted.",
      payloadFields: {
        accountId: { type: "number" },
        calendarId: { type: "string" },
        eventId: { type: "string" },
        title: { type: "string" },
      },
    },
    {
      type: "calendar.event_attendance_changed",
      label: "Attendance changed",
      description:
        "This account's attendance on an event changed - a real Google accept/decline on an invitation, or a local not-attending note on any other event.",
      payloadFields: {
        accountId: { type: "number" },
        calendarId: { type: "string" },
        eventId: { type: "string" },
        title: { type: "string" },
        notAttending: { type: "boolean" },
        url: { type: "string" },
      },
    },
  ],
};
