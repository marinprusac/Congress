import { migrationsDir } from "@congress/test-support";
import { setCongressHost } from "@congress/chamber-kit";
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
  const publish = vi.fn();

  beforeEach(() => {
    db.run("delete from google_accounts");
    vi.mocked(refreshAccessToken).mockReset();
    publish.mockReset();
    setCongressHost({ publishEvent: publish, syncExhibit: () => {}, resolveExhibits: async () => [] });
  });

  afterEach(() => {
    setCongressHost(null);
  });

  it("publishes calendar.account_needs_reconnect the first time a refresh is revoked", async () => {
    insertExpiredAccount(1);
    vi.mocked(refreshAccessToken).mockRejectedValue(new RevokedTokenError());

    await expect(ensureFreshAccessToken(getAccountRow(1)!)).rejects.toThrow(AccountNeedsReconnectError);

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]![0]).toMatchObject({
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
    expect(publish).toHaveBeenCalledTimes(1);

    // A later call (e.g. the next poll cycle) still sees a stale token and
    // re-checks the same already-flagged account.
    await expect(ensureFreshAccessToken(getAccountRow(1)!)).rejects.toThrow(AccountNeedsReconnectError);
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
