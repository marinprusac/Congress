// Calendar guests never create People (being on an invite isn't contact); they
// only link to People that already exist, matched by email.

export interface GuestRow {
  email: string;
  self: boolean;
  resource: boolean;
  personId: string | null;
}

export function guestsToLink<T extends GuestRow>(guests: T[], ownEmails: Set<string>): T[] {
  return guests.filter((g) => !g.self && !g.resource && !ownEmails.has(g.email) && g.personId === null);
}
