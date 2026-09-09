import { randomUUID } from "node:crypto";
import type { CalendarEvent, CreateEventRequest, ListEventsResponse, MoveEventRequest, UpdateEventRequest } from "./types.js";
import {
  listEvents as listGoogleEvents,
  searchEvents as searchGoogleEvents,
  getEvent as getGoogleEvent,
  createEvent as createGoogleEvent,
  updateEvent as updateGoogleEvent,
  deleteEvent as deleteGoogleEvent,
  setEventAttendance as setGoogleEventAttendance,
  syncEventExhibit,
} from "./google/events.js";
import { isLocalEventKey, parseExhibitId, toExhibitId, eventUrl } from "./google/eventId.js";
import {
  listLocalEvents,
  searchLocalEvents,
  getLocalEvent,
  insertLocalEvent,
  updateLocalEventRow,
  deleteLocalEventRow,
  LocalEventNotFoundError,
} from "./localEvents.js";
import { combineRankedEventSearch } from "./eventSearch.js";
import { publishEvent } from "./events.js";
import { pushExhibitSync } from "./exhibits.js";
import { deleteManualRefsForEvent, moveManualRefs } from "./refs.js";
import { setLocalNotAttending, deleteLocalAttendance, moveLocalAttendance } from "./attendance.js";

// The one layer that sits *above* both a Google-backed event
// (google/events.ts) and a locally-stored one (localEvents.ts), merging
// reads across the two and wiring a local write up to the same exhibit-
// sync/event-publish treatment google/events.ts's own create/update/delete
// already give a Google write. server.ts and mcp/tools.ts talk to this
// module instead of google/events.ts directly - it's the one export surface
// that always covers both event sources, so neither call site has to know
// which store a given (accountId, calendarId) key actually belongs to.
export { LocalEventNotFoundError };

export class InvalidEventRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidEventRequestError";
  }
}

export async function listEvents(fromISO: string, toISO: string): Promise<ListEventsResponse> {
  const google = await listGoogleEvents(fromISO, toISO);
  const local = listLocalEvents(fromISO, toISO);
  const events = [...google.events, ...local].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
  );
  return { events, accountErrors: google.accountErrors };
}

export async function searchEvents(query: string, limit = 20): Promise<ListEventsResponse> {
  if (!query.trim()) return { events: [], accountErrors: [] };
  const google = await searchGoogleEvents(query, limit);
  const local = searchLocalEvents(query, limit);
  return { events: combineRankedEventSearch(google.events, local, query, limit), accountErrors: google.accountErrors };
}

export async function getEvent(accountId: number, calendarId: string, eventId: string): Promise<CalendarEvent> {
  if (isLocalEventKey(accountId, calendarId)) {
    const event = getLocalEvent(eventId);
    if (!event) throw new LocalEventNotFoundError(eventId);
    return event;
  }
  return getGoogleEvent(accountId, calendarId, eventId);
}

// A calendar left unselected in the create form means "store this locally"
// - accountId/calendarId are both absent from the request in that case (see
// createEventRequestSchema's own refine in types.ts). Any other combination
// (exactly one of the two present) is a malformed request, not a valid
// Google event or a valid local one.
export async function createEvent(input: CreateEventRequest): Promise<CalendarEvent> {
  const hasAccountId = input.accountId !== undefined;
  const hasCalendarId = input.calendarId !== undefined;
  if (!hasAccountId && !hasCalendarId) {
    const result = await insertLocalEvent(randomUUID(), input);
    await syncEventExhibit(result);
    void publishEvent({
      type: "calendar.event_created",
      payload: { accountId: result.accountId, calendarId: result.calendarId, eventId: result.id, title: result.title, url: eventUrl(result.accountId, result.calendarId, result.id) },
    });
    return result;
  }
  if (!hasAccountId || !hasCalendarId) {
    throw new InvalidEventRequestError("accountId and calendarId must both be provided (a Google event), or both left out (a local event).");
  }
  // createEventRequestSchema's own refine already guarantees timeZone is
  // present whenever accountId is - safe to assert past the wire-level
  // Optional here, the same way accountId/calendarId are just below.
  return createGoogleEvent({ ...input, accountId: input.accountId!, calendarId: input.calendarId!, timeZone: input.timeZone! });
}

export async function updateEvent(
  accountId: number,
  calendarId: string,
  eventId: string,
  input: UpdateEventRequest
): Promise<CalendarEvent> {
  if (isLocalEventKey(accountId, calendarId)) {
    const result = await updateLocalEventRow(eventId, input);
    await syncEventExhibit(result);
    void publishEvent({
      type: "calendar.event_updated",
      payload: { accountId: result.accountId, calendarId: result.calendarId, eventId: result.id, title: result.title, url: eventUrl(result.accountId, result.calendarId, result.id) },
    });
    return result;
  }
  return updateGoogleEvent(accountId, calendarId, eventId, input);
}

// Mirrors google/events.ts's own deleteEvent step for step (drop the row,
// drop its manual refs and local attendance note, push a tombstone sync,
// publish the deletion) - just against localEvents.ts's own row instead of
// the cachedEvents mirror and no external Google DELETE call to make first.
export async function deleteEvent(accountId: number, calendarId: string, eventId: string): Promise<void> {
  if (isLocalEventKey(accountId, calendarId)) {
    const deleted = deleteLocalEventRow(eventId);
    const exhibitId = toExhibitId(accountId, calendarId, eventId);
    deleteManualRefsForEvent(exhibitId);
    deleteLocalAttendance(exhibitId);
    await pushExhibitSync({ id: exhibitId, type: "event", name: deleted.title, url: eventUrl(accountId, calendarId, eventId), outgoingRefs: [], deleted: true });
    void publishEvent({ type: "calendar.event_deleted", payload: { accountId, calendarId, eventId, title: deleted.title } });
    return;
  }
  return deleteGoogleEvent(accountId, calendarId, eventId);
}

// Changes which store is the source of truth for an event - moves it onto a
// different Google account/calendar, or onto/off of this Chamber's own local
// storage. Implemented as create-at-target then delete-at-source (via this
// same module's own createEvent/deleteEvent, so each still gets its usual
// exhibit-sync/event-publish treatment) rather than Google's own
// events.move, which only ever covers a same-account calendar change anyway
// and wouldn't help at all for a local<->Google move - one dispatch that
// handles every direction uniformly is worth the extra round trip. The
// event's exhibit id necessarily changes with it (ids are scoped to the
// calendar/account that stores the event), so this event's own manual refs
// and any local "not attending" note are re-keyed onto the new id before the
// old one is torn down; anything *pointing at* this event from elsewhere
// (a note's own wikilink, say) is not rewritten, the same limitation a
// delete-and-recreate would have - there is no rename propagation anywhere
// in the exhibit system.
export async function moveEvent(
  accountId: number,
  calendarId: string,
  eventId: string,
  target: MoveEventRequest
): Promise<CalendarEvent> {
  const source = await getEvent(accountId, calendarId, eventId);
  if (!source.editable) {
    throw new InvalidEventRequestError(`"${source.title}" can't be moved - it's managed by its organizer, not this account.`);
  }

  const targetIsLocal = target.accountId === undefined;
  const sourceIsLocal = isLocalEventKey(accountId, calendarId);
  const sameCalendar = !targetIsLocal && !sourceIsLocal && target.accountId === accountId && target.calendarId === calendarId;
  if (sameCalendar || (targetIsLocal && sourceIsLocal)) {
    throw new InvalidEventRequestError("This event is already stored there.");
  }

  const created = await createEvent({
    accountId: target.accountId,
    calendarId: target.calendarId,
    timeZone: target.timeZone,
    title: source.title,
    description: source.description ?? undefined,
    location: source.location ?? undefined,
    descriptionRich: source.descriptionRich ?? undefined,
    locationRich: source.locationRich ?? undefined,
    allDay: source.allDay,
    start: source.start,
    end: source.end,
  });

  const oldExhibitId = toExhibitId(accountId, calendarId, eventId);
  const newExhibitId = toExhibitId(created.accountId, created.calendarId, created.id);
  moveManualRefs(oldExhibitId, newExhibitId);
  moveLocalAttendance(oldExhibitId, newExhibitId);
  await resyncEventExhibit(newExhibitId);

  await deleteEvent(accountId, calendarId, eventId);

  return created;
}

// notAttending on a local event is always just the same private local note
// a non-invitation Google event gets (see attendance.ts) - there's no
// Google RSVP to patch, so unlike setGoogleEventAttendance this never needs
// to branch on isInvitation.
export async function setEventAttendance(
  accountId: number,
  calendarId: string,
  eventId: string,
  notAttending: boolean
): Promise<CalendarEvent> {
  if (isLocalEventKey(accountId, calendarId)) {
    setLocalNotAttending(toExhibitId(accountId, calendarId, eventId), notAttending);
    const event = getLocalEvent(eventId);
    if (!event) throw new LocalEventNotFoundError(eventId);
    void publishEvent({
      type: "calendar.event_attendance_changed",
      payload: { accountId, calendarId, eventId, title: event.title, notAttending, url: eventUrl(accountId, calendarId, eventId) },
    });
    return event;
  }
  return setGoogleEventAttendance(accountId, calendarId, eventId, notAttending);
}

// Re-syncs an event whose description didn't change but whose manual refs
// did (see the /api/exhibits/:id/refs routes in server.ts) - lives here
// rather than in google/events.ts (its old home before local events
// existed) because it now has to dispatch through this module's own getEvent
// to cover a local event's manual refs too, and google/events.ts can't call
// back into this module without creating a cycle.
export async function resyncEventExhibit(exhibitId: string): Promise<void> {
  const parsed = parseExhibitId(exhibitId);
  if (!parsed) return;
  try {
    const event = await getEvent(parsed.accountId, parsed.calendarId, parsed.eventId);
    await syncEventExhibit(event);
  } catch {
    // A transient Google error, or a local event that's since been
    // deleted, shouldn't fail the manual-ref add/remove that triggered
    // this resync.
  }
}
