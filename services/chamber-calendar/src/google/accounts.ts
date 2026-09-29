import { eq } from "drizzle-orm";
import {
  getGoogleAccount,
  googleAccessToken,
  hasGoogleScopes,
  importLegacyGoogleAccounts,
  listGoogleAccounts,
  GoogleAccountNeedsReconnectError,
  GoogleScopeMissingError,
} from "@congress/chamber-kit";
import type { GoogleAccount } from "../types.js";
import { db } from "../db/client.js";
import { cachedEvents, legacyGoogleAccounts, selectedCalendars } from "../db/schema.js";

// Accounts and tokens live in Congress's Google connector; this Chamber only asks for access.
export const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

export { GoogleAccountNeedsReconnectError as AccountNeedsReconnectError };

export type AccountRow = { id: number; label: string };

function toDTO(account: ReturnType<typeof listGoogleAccounts>[number]): GoogleAccount {
  return {
    id: account.id,
    label: account.label,
    email: account.email,
    needsReconnect: account.needsReconnect,
    hasAccess: hasGoogleScopes(account, CALENDAR_SCOPES),
    connectedAt: account.connectedAt,
  };
}

export function listAccounts(): GoogleAccount[] {
  return listGoogleAccounts().map(toDTO);
}

export function getAccountRow(id: number): AccountRow | undefined {
  return getGoogleAccount(id);
}

// A missing Calendar grant is reported the same way as a revoked token:
// the owner fixes both by reconnecting the account.
export async function ensureFreshAccessToken(account: AccountRow): Promise<string> {
  try {
    return await googleAccessToken(account.id, CALENDAR_SCOPES);
  } catch (err) {
    if (err instanceof GoogleScopeMissingError) throw new GoogleAccountNeedsReconnectError(account.id, account.label);
    throw err;
  }
}

// One-time handover of the accounts this Chamber stored before the connector existed.
export function migrateLegacyAccounts(): void {
  const rows = db.select().from(legacyGoogleAccounts).all();
  if (rows.length === 0) return;
  const idMap = importLegacyGoogleAccounts(rows);
  db.transaction((tx) => {
    for (const [oldId, newId] of idMap) {
      if (oldId === newId) continue;
      console.warn(`[calendar] Google account ${oldId} became ${newId}; its cached events will resync`);
      tx.update(selectedCalendars).set({ accountId: newId, syncToken: null }).where(eq(selectedCalendars.accountId, oldId)).run();
      tx.delete(cachedEvents).where(eq(cachedEvents.accountId, oldId)).run();
    }
    tx.delete(legacyGoogleAccounts).run();
  });
}

// Drops everything tied to an account the owner disconnected in Congress.
export function forgetAccount(accountId: number): void {
  db.transaction((tx) => {
    tx.delete(selectedCalendars).where(eq(selectedCalendars.accountId, accountId)).run();
    tx.delete(cachedEvents).where(eq(cachedEvents.accountId, accountId)).run();
  });
}
