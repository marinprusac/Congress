import { eq } from "drizzle-orm";
import type { GoogleAccount } from "../types.js";
import { db } from "../db/client.js";
import { googleAccounts } from "../db/schema.js";
import { refreshAccessToken, revokeToken, RevokedTokenError } from "./oauth.js";
import { publishEvent } from "../events.js";

export class AccountNeedsReconnectError extends Error {
  accountId: number;
  label: string;
  constructor(accountId: number, label: string) {
    super(`Account "${label}" needs to be reconnected`);
    this.name = "AccountNeedsReconnectError";
    this.accountId = accountId;
    this.label = label;
  }
}

type AccountRow = typeof googleAccounts.$inferSelect;

function toDTO(row: AccountRow): GoogleAccount {
  return {
    id: row.id,
    label: row.label,
    email: row.email,
    needsReconnect: row.needsReconnect,
    connectedAt: row.connectedAt.toISOString(),
  };
}

export function listAccounts(): GoogleAccount[] {
  const rows = db.select().from(googleAccounts).all();
  return rows.map(toDTO);
}

export function getAccountRow(id: number): AccountRow | undefined {
  return db.select().from(googleAccounts).where(eq(googleAccounts.id, id)).get();
}

export function listAccountRows(): AccountRow[] {
  return db.select().from(googleAccounts).all();
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
  const existing = db
    .select()
    .from(googleAccounts)
    .where(eq(googleAccounts.googleSub, input.sub))
    .get();

  if (existing) {
    const row = db
      .update(googleAccounts)
      .set({
        email: input.email,
        accessToken: input.accessToken,
        // Google only returns a refresh_token on the very first consent for a
        // given client+account; keep the previously stored one otherwise.
        refreshToken: input.refreshToken ?? existing.refreshToken,
        scope: input.scope,
        tokenExpiry: new Date(input.expiryMs),
        needsReconnect: false,
        updatedAt: now,
      })
      .where(eq(googleAccounts.id, existing.id))
      .returning()
      .get();
    return toDTO(row);
  }

  if (!input.refreshToken) {
    throw new Error("Google did not return a refresh token on first consent");
  }

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
  void publishEvent({
    type: "calendar.account_connected",
    payload: { accountId: row.id, label: row.label },
  });
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
  const existing = getAccountRow(id);
  if (!existing) return false;
  await revokeToken(existing.refreshToken);
  const result = db.delete(googleAccounts).where(eq(googleAccounts.id, id)).run();
  if (result.changes > 0) {
    void publishEvent({
      type: "calendar.account_disconnected",
      payload: { accountId: id, label: existing.label },
    });
  }
  return result.changes > 0;
}

const EXPIRY_BUFFER_MS = 60_000;

export async function ensureFreshAccessToken(account: AccountRow): Promise<string> {
  if (account.tokenExpiry.getTime() > Date.now() + EXPIRY_BUFFER_MS) {
    return account.accessToken;
  }

  try {
    const refreshed = await refreshAccessToken(account.refreshToken);
    db.update(googleAccounts)
      .set({
        accessToken: refreshed.accessToken,
        tokenExpiry: new Date(refreshed.expiryMs),
        needsReconnect: false,
        updatedAt: new Date(),
      })
      .where(eq(googleAccounts.id, account.id))
      .run();
    return refreshed.accessToken;
  } catch (err) {
    if (err instanceof RevokedTokenError) {
      db.update(googleAccounts)
        .set({ needsReconnect: true, updatedAt: new Date() })
        .where(eq(googleAccounts.id, account.id))
        .run();
      throw new AccountNeedsReconnectError(account.id, account.label);
    }
    throw err;
  }
}
