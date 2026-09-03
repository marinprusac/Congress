import { migrationsDir } from "@congress/test-support";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./oauth.js", async () => {
  const actual = await vi.importActual<typeof import("./oauth.js")>("./oauth.js");
  return { ...actual, refreshAccessToken: vi.fn() };
});

import { db, runMigrations } from "../db/client.js";
import { googleAccounts } from "../db/schema.js";
import { AccountNeedsReconnectError, ensureFreshAccessToken, getAccountRow } from "./accounts.js";
import { refreshAccessToken, RevokedTokenError } from "./oauth.js";

beforeAll(() => {
  runMigrations(migrationsDir("chamber-calendar"));
});

function insertExpiredAccount(id: number) {
  db.insert(googleAccounts)
    .values({
      id,
      label: `Account ${id}`,
      email: `account-${id}@example.com`,
      googleSub: `sub-${id}`,
      accessToken: "at",
      refreshToken: "rt",
      scope: "scope",
      tokenExpiry: new Date(0),
      connectedAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
}

describe("ensureFreshAccessToken", () => {
  beforeEach(() => {
    db.run("delete from google_accounts");
    vi.mocked(refreshAccessToken).mockReset();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("publishes calendar.account_needs_reconnect the first time a refresh is revoked", async () => {
    insertExpiredAccount(1);
    vi.mocked(refreshAccessToken).mockRejectedValue(new RevokedTokenError());

    await expect(ensureFreshAccessToken(getAccountRow(1)!)).rejects.toThrow(AccountNeedsReconnectError);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:9/congress/events/publish");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      chamber: "calendar",
      type: "calendar.account_needs_reconnect",
      payload: { accountId: 1, label: "Account 1" },
    });
    expect(getAccountRow(1)!.needsReconnect).toBe(true);
  });

  it("does not re-publish on a later call while the account is still unreconnected", async () => {
    insertExpiredAccount(1);
    vi.mocked(refreshAccessToken).mockRejectedValue(new RevokedTokenError());

    await expect(ensureFreshAccessToken(getAccountRow(1)!)).rejects.toThrow(AccountNeedsReconnectError);
    expect(fetch).toHaveBeenCalledTimes(1);

    // A later call (e.g. the next poll cycle) still sees a stale token and
    // re-checks the same already-flagged account.
    await expect(ensureFreshAccessToken(getAccountRow(1)!)).rejects.toThrow(AccountNeedsReconnectError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
