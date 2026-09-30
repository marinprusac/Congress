import type { Evidence } from "../../typeEngine/lookups.js";

// Which attendees to look up as People, and with what evidence.

export interface AttendeeRow {
  email: string;
  displayName: string | null;
  self: boolean;
  resource: boolean;
  personId: string | null;
  triedEvidence: string | null;
}

const RANK: Record<string, number> = { seen: 1, corresponded: 2 };

// The owner organized it or said yes: they corresponded with its guests.
export function attendeeEvidence(event: { organizerSelf: boolean; selfResponse: string | null }): Evidence {
  return event.organizerSelf || event.selfResponse === "accepted" ? "corresponded" : "seen";
}

export function attendeesToResolve(attendees: AttendeeRow[], evidence: Evidence, ownEmails: Set<string>): AttendeeRow[] {
  return attendees.filter(
    (a) =>
      !a.self &&
      !a.resource &&
      !ownEmails.has(a.email) &&
      a.personId === null &&
      (RANK[evidence] ?? 0) > (RANK[a.triedEvidence ?? ""] ?? 0)
  );
}
