import type { GoogleAccount } from "@congress/shared-types";
import { getCongressHost } from "./host.js";

// A Chamber's pre-connector account row, handed over once on migration.
export interface LegacyGoogleAccount {
  id: number;
  label: string;
  email: string;
  googleSub: string;
  accessToken: string;
  refreshToken: string;
  scope: string;
  tokenExpiry: Date;
  needsReconnect: boolean;
  connectedAt: Date;
}

// Congress's Google connector as a Chamber sees it (services/congress/src/connectors/google).
export interface GoogleConnectorHost {
  listAccounts(): GoogleAccount[];
  getAccessToken(accountId: number, scopes: string[]): Promise<string>;
  // Maps each legacy id to the connector id it ended up with.
  importLegacyAccounts(rows: LegacyGoogleAccount[]): Map<number, number>;
}

export class GoogleConnectorUnavailableError extends Error {
  constructor() {
    super("Google connector is not available");
    this.name = "GoogleConnectorUnavailableError";
  }
}

export class GoogleAccountNotFoundError extends Error {
  accountId: number;
  constructor(accountId: number) {
    super(`Google account ${accountId} is not connected`);
    this.name = "GoogleAccountNotFoundError";
    this.accountId = accountId;
  }
}

export class GoogleAccountNeedsReconnectError extends Error {
  accountId: number;
  label: string;
  constructor(accountId: number, label: string) {
    super(`Account "${label}" needs to be reconnected`);
    this.name = "GoogleAccountNeedsReconnectError";
    this.accountId = accountId;
    this.label = label;
  }
}

export class GoogleScopeMissingError extends Error {
  accountId: number;
  label: string;
  missing: string[];
  constructor(accountId: number, label: string, missing: string[]) {
    super(`Account "${label}" hasn't granted access: ${missing.join(", ")}`);
    this.name = "GoogleScopeMissingError";
    this.accountId = accountId;
    this.label = label;
    this.missing = missing;
  }
}

function connector(): GoogleConnectorHost {
  const google = getCongressHost()?.google;
  if (!google) throw new GoogleConnectorUnavailableError();
  return google;
}

// Empty outside Congress (no host), same as "nothing connected".
export function listGoogleAccounts(): GoogleAccount[] {
  return getCongressHost()?.google?.listAccounts() ?? [];
}

export function getGoogleAccount(accountId: number): GoogleAccount | undefined {
  return listGoogleAccounts().find((a) => a.id === accountId);
}

export function hasGoogleScopes(account: GoogleAccount, scopes: string[]): boolean {
  return scopes.every((s) => account.scopes.includes(s));
}

export function googleAccessToken(accountId: number, scopes: string[]): Promise<string> {
  return connector().getAccessToken(accountId, scopes);
}

export function importLegacyGoogleAccounts(rows: LegacyGoogleAccount[]): Map<number, number> {
  return connector().importLegacyAccounts(rows);
}
