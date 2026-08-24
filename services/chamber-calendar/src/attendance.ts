import { eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { eventAttendance } from "./db/schema.js";
import type { AttendanceStatus, EventAttendance } from "./types.js";

// Leaf module (no imports of its own besides db/schema/types) so both
// google/events.ts (live fetch/write path) and google/cache.ts (poll-sync
// read path) can share this without either depending on the other.

const RESPONSE_STATUSES: readonly string[] = ["needsAction", "declined", "tentative", "accepted"];

function toAttendanceStatus(value: string | undefined): AttendanceStatus | null {
  return value !== undefined && RESPONSE_STATUSES.includes(value) ? (value as AttendanceStatus) : null;
}

// True (and worth a response) only when this account is a listed attendee
// who didn't organize the event - the case Google Calendar itself treats as
// an invitation to accept/decline. An organizer who also lists themself as
// an attendee (common when inviting others alongside yourself) still owns
// the event, not something to respond to.
export function computeGoogleAttendance(raw: {
  organizer?: { self?: boolean };
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
}): { isInvitation: boolean; responseStatus: AttendanceStatus | null } {
  const selfAttendee = raw.attendees?.find((a) => a.self === true);
  if (!selfAttendee || raw.organizer?.self === true) return { isInvitation: false, responseStatus: null };
  return { isInvitation: true, responseStatus: toAttendanceStatus(selfAttendee.responseStatus) };
}

export function getLocalNotAttending(exhibitId: string): boolean {
  const row = db
    .select({ notAttending: eventAttendance.notAttending })
    .from(eventAttendance)
    .where(eq(eventAttendance.exhibitId, exhibitId))
    .get();
  return row?.notAttending ?? false;
}

export function setLocalNotAttending(exhibitId: string, notAttending: boolean): void {
  db.insert(eventAttendance)
    .values({ exhibitId, notAttending, updatedAt: new Date() })
    .onConflictDoUpdate({ target: eventAttendance.exhibitId, set: { notAttending, updatedAt: new Date() } })
    .run();
}

export function deleteLocalAttendance(exhibitId: string): void {
  db.delete(eventAttendance).where(eq(eventAttendance.exhibitId, exhibitId)).run();
}

// Combines Google's own RSVP (when this event is an invitation) with the
// local-only note (when it isn't) into the one field CalendarEvent exposes.
export function resolveAttendance(
  google: { isInvitation: boolean; responseStatus: AttendanceStatus | null },
  exhibitId: string
): EventAttendance {
  if (google.isInvitation) {
    return { isInvitation: true, responseStatus: google.responseStatus, notAttending: google.responseStatus === "declined" };
  }
  return { isInvitation: false, responseStatus: null, notAttending: getLocalNotAttending(exhibitId) };
}
