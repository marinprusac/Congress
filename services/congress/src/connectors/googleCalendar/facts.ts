// Google's event shape (the fields this connector reads) and the pure rules on it.

export interface RawAttendee {
  email?: string;
  displayName?: string;
  self?: boolean;
  organizer?: boolean;
  resource?: boolean;
  optional?: boolean;
  responseStatus?: string;
}

export interface RawGoogleEvent {
  id: string;
  status?: string;
  updated?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  recurringEventId?: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  organizer?: { email?: string; self?: boolean };
  guestsCanModify?: boolean;
  attendees?: RawAttendee[];
}

export const RESPONSES = ["needsAction", "declined", "tentative", "accepted"] as const;
export type Response = (typeof RESPONSES)[number];

export interface EventFacts {
  editable: boolean;
  isInvitation: boolean;
  canRsvp: boolean;
  selfResponse: Response | null;
}

export function eventFacts(e: { organizerSelf: boolean; hasOrganizer: boolean; guestsCanModify: boolean; selfResponse: string | null; hasSelfAttendee: boolean }): EventFacts {
  const editable = !e.hasOrganizer || e.organizerSelf || e.guestsCanModify;
  const isInvitation = e.hasSelfAttendee && !e.organizerSelf;
  const selfResponse = (RESPONSES as readonly string[]).includes(e.selfResponse ?? "") ? (e.selfResponse as Response) : null;
  return { editable, isInvitation, canRsvp: isInvitation, selfResponse };
}

export function rawFacts(raw: RawGoogleEvent): EventFacts {
  const self = raw.attendees?.find((a) => a.self === true);
  return eventFacts({
    organizerSelf: raw.organizer?.self === true,
    hasOrganizer: raw.organizer !== undefined,
    guestsCanModify: raw.guestsCanModify === true,
    selfResponse: self?.responseStatus ?? null,
    hasSelfAttendee: self !== undefined,
  });
}

// Epoch ms of a Google time; an all-day date is taken as UTC midnight.
export function timeMs(t: { date?: string; dateTime?: string }): number {
  if (t.dateTime) return Date.parse(t.dateTime);
  if (t.date) return Date.parse(`${t.date}T00:00:00Z`);
  return Number.NaN;
}
