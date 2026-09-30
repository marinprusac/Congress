// Errors of the Google connector's token helper (callers catch them to report per-account problems), and the legacy account row shape.

// A retired Chamber's pre-connector account row, handed over once on migration.
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
