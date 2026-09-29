import { eq } from "drizzle-orm";
import type { GoogleAccount, GoogleConnectorStatus } from "@congress/shared-types";
import {
  GoogleAccountNeedsReconnectError,
  GoogleAccountNotFoundError,
  GoogleConnectorUnavailableError,
  GoogleScopeMissingError,
  type LegacyGoogleAccount,
} from "@congress/chamber-kit";
import { db } from "../../db/client.js";
import { googleAccounts } from "../../db/schema.js";
import { publishEvent } from "../../events.js";
import { listModules } from "../../chambers/runtime.js";
import { googleClientConfig } from "./config.js";
import { refreshAccessToken, revokeToken, RevokedTokenError } from "./oauth.js";

type AccountRow = typeof googleAccounts.$inferSelect;

export function scopesOf(scope: string): string[] {
  return scope.split(/\s+/).filter(Boolean);
}

function toDTO(row: AccountRow): GoogleAccount {
  return {
    id: row.id,
    label: row.label,
    email: row.email,
    scopes: scopesOf(row.scope),
    needsReconnect: row.needsReconnect,
    connectedAt: row.connectedAt.toISOString(),
  };
}

export function listGoogleAccounts(): GoogleAccount[] {
  return db.select().from(googleAccounts).all().map(toDTO);
}

function getRow(id: number): AccountRow | undefined {
  return db.select().from(googleAccounts).where(eq(googleAccounts.id, id)).get();
}

// Every loaded Chamber that declared googleScopes in its manifest.
export function googleRequesters(): Array<{ chamber: string; displayName: string; scopes: string[] }> {
  return listModules()
    .filter((m) => (m.manifest.googleScopes ?? []).length > 0)
    .map((m) => ({ chamber: m.manifest.name, displayName: m.manifest.displayName, scopes: m.manifest.googleScopes ?? [] }));
}

export function requestedScopes(): string[] {
  return [...new Set(googleRequesters().flatMap((r) => r.scopes))];
}

export function googleConnectorStatus(): GoogleConnectorStatus {
  const requesters = googleRequesters();
  return {
    configured: googleClientConfig() !== null,
    requesters,
    accounts: listGoogleAccounts().map((account) => ({
      ...account,
      missing: requesters
        .map((r) => ({ ...r, scopes: r.scopes.filter((s) => !account.scopes.includes(s)) }))
        .filter((r) => r.scopes.length > 0),
    })),
  };
}

export function upsertAccountFromOAuth(input: {
  sub: string;
  email: string;
  accessToken: string;
  refreshToken: string | undefined;
  scope: string;
  expiryMs: number;
}): GoogleAccount {
  const now = new Date();
  const existing = db.select().from(googleAccounts).where(eq(googleAccounts.googleSub, input.sub)).get();

  if (existing) {
    const row = db
      .update(googleAccounts)
      .set({
        email: input.email,
        accessToken: input.accessToken,
        // Google only sometimes returns a new refresh token; keep the old one otherwise.
        refreshToken: input.refreshToken ?? existing.refreshToken,
        scope: input.scope,
        tokenExpiry: new Date(input.expiryMs),
        needsReconnect: false,
        updatedAt: now,
      })
      .where(eq(googleAccounts.id, existing.id))
      .returning()
      .get();
    publishEvent({ chamber: "congress", type: "google.account_connected", payload: { accountId: row.id, label: row.label } });
    return toDTO(row);
  }

  if (!input.refreshToken) throw new Error("Google did not return a refresh token on first consent");

  const row = db
    .insert(googleAccounts)
    .values({
      label: input.email,
      email: input.email,
      googleSub: input.sub,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      scope: input.scope,
      tokenExpiry: new Date(input.expiryMs),
      needsReconnect: false,
      connectedAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  publishEvent({ chamber: "congress", type: "google.account_connected", payload: { accountId: row.id, label: row.label } });
  return toDTO(row);
}

export function updateAccountLabel(id: number, label: string): GoogleAccount | null {
  const row = db
    .update(googleAccounts)
    .set({ label, updatedAt: new Date() })
    .where(eq(googleAccounts.id, id))
    .returning()
    .get();
  return row ? toDTO(row) : null;
}

export async function disconnectAccount(id: number): Promise<boolean> {
  const existing = getRow(id);
  if (!existing) return false;
  await revokeToken(existing.refreshToken);
  const result = db.delete(googleAccounts).where(eq(googleAccounts.id, id)).run();
  if (result.changes > 0) {
    publishEvent({ chamber: "congress", type: "google.account_disconnected", payload: { accountId: id, label: existing.label } });
  }
  return result.changes > 0;
}

const EXPIRY_BUFFER_MS = 60_000;
// One refresh per account at a time, however many Chambers ask at once.
const inflight = new Map<number, Promise<string>>();

async function refresh(row: AccountRow): Promise<string> {
  const config = googleClientConfig();
  if (!config) throw new GoogleConnectorUnavailableError();
  try {
    const refreshed = await refreshAccessToken(config, row.refreshToken);
    db.update(googleAccounts)
      .set({ accessToken: refreshed.accessToken, tokenExpiry: new Date(refreshed.expiryMs), needsReconnect: false, updatedAt: new Date() })
      .where(eq(googleAccounts.id, row.id))
      .run();
    return refreshed.accessToken;
  } catch (err) {
    if (err instanceof RevokedTokenError) {
      db.update(googleAccounts).set({ needsReconnect: true, updatedAt: new Date() }).where(eq(googleAccounts.id, row.id)).run();
      if (!row.needsReconnect) {
        publishEvent({ chamber: "congress", type: "google.account_needs_reconnect", payload: { accountId: row.id, label: row.label } });
      }
      throw new GoogleAccountNeedsReconnectError(row.id, row.label);
    }
    throw err;
  }
}

export async function getAccessToken(accountId: number, scopes: string[]): Promise<string> {
  const row = getRow(accountId);
  if (!row) throw new GoogleAccountNotFoundError(accountId);
  const granted = scopesOf(row.scope);
  const missing = scopes.filter((s) => !granted.includes(s));
  if (missing.length > 0) throw new GoogleScopeMissingError(row.id, row.label, missing);
  if (row.tokenExpiry.getTime() > Date.now() + EXPIRY_BUFFER_MS) return row.accessToken;

  const pending = inflight.get(row.id);
  if (pending) return pending;
  const next = refresh(row).finally(() => inflight.delete(row.id));
  inflight.set(row.id, next);
  return next;
}

// A Chamber's pre-connector accounts. Keeps each id when it's free, so the
// Chamber's stored account ids (and exhibit ids) stay valid.
export function importLegacyAccounts(rows: LegacyGoogleAccount[]): Map<number, number> {
  const idMap = new Map<number, number>();
  for (const legacy of rows) {
    const bySub = db.select().from(googleAccounts).where(eq(googleAccounts.googleSub, legacy.googleSub)).get();
    if (bySub) {
      idMap.set(legacy.id, bySub.id);
      continue;
    }
    const idTaken = getRow(legacy.id) !== undefined;
    const row = db
      .insert(googleAccounts)
      .values({
        ...(idTaken ? {} : { id: legacy.id }),
        label: legacy.label,
        email: legacy.email,
        googleSub: legacy.googleSub,
        accessToken: legacy.accessToken,
        refreshToken: legacy.refreshToken,
        scope: legacy.scope,
        tokenExpiry: legacy.tokenExpiry,
        needsReconnect: legacy.needsReconnect,
        connectedAt: legacy.connectedAt,
        updatedAt: new Date(),
      })
      .returning()
      .get();
    idMap.set(legacy.id, row.id);
  }
  return idMap;
}
