import { migrationsDir } from "@congress/test-support";
import { GoogleScopeMissingError, setCongressHost } from "@congress/chamber-kit";
import type { GoogleAccount } from "@congress/shared-types";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, runMigrations } from "./db/client.js";
import { getCachedMessage, toCacheRow, upsertCachedMessage } from "./cache.js";
import { GMAIL_MODIFY, GMAIL_READONLY, getLabel } from "./gmail/client.js";
import { listMailAccounts, markThreadRead } from "./mail.js";

const accounts: GoogleAccount[] = [
  { id: 1, label: "Synced", email: "a@example.com", scopes: [GMAIL_MODIFY], needsReconnect: false, connectedAt: "" },
  { id: 2, label: "Old grant", email: "b@example.com", scopes: [GMAIL_READONLY], needsReconnect: false, connectedAt: "" },
];
const tokenRequests: Array<[number, string[]]> = [];
const fetchMock = vi.fn();

beforeAll(() => runMigrations(migrationsDir("chamber-mail")));

beforeEach(() => {
  db.run("delete from messages");
  tokenRequests.length = 0;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ id: "INBOX" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  setCongressHost({
    publishEvent: () => {},
    syncExhibit: () => {},
    resolveExhibits: async () => [],
    google: {
      listAccounts: () => accounts,
      // Same scope check the real connector does.
      getAccessToken: async (id, scopes) => {
        tokenRequests.push([id, scopes]);
        const account = accounts.find((a) => a.id === id)!;
        const missing = scopes.filter((s) => !account.scopes.includes(s));
        if (missing.length) throw new GoogleScopeMissingError(id, account.label, missing);
        return `token-${id}`;
      },
      importLegacyAccounts: () => new Map(),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setCongressHost(null);
});

function cache(accountId: number, id: string, threadId: string, labels: string[]) {
  upsertCachedMessage(
    toCacheRow(
      { id, threadId, labelIds: labels, internalDate: String(Date.now()), payload: { headers: [{ name: "Subject", value: "Hi" }] } },
      accountId
    )
  );
}

describe("markThreadRead", () => {
  it("removes UNREAD in Gmail and in the local mirror", async () => {
    cache(1, "m1", "T", ["INBOX", "UNREAD"]);
    cache(1, "m2", "T", ["INBOX", "UNREAD", "IMPORTANT"]);
    cache(1, "m3", "OTHER", ["INBOX", "UNREAD"]);

    await expect(markThreadRead(1, "T")).resolves.toMatchObject({ markedLocally: 2 });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/threads/T/modify");
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify({ removeLabelIds: ["UNREAD"] }) });
    expect(tokenRequests).toEqual([[1, [GMAIL_MODIFY]]]);
    expect(getCachedMessage(1, "m2")).toMatchObject({ unread: false, labelIds: JSON.stringify(["INBOX", "IMPORTANT"]) });
    expect(getCachedMessage(1, "m3")?.unread).toBe(true);
  });

  it("leaves everything unread when the account only granted read access", async () => {
    cache(2, "m1", "T", ["INBOX", "UNREAD"]);
    await expect(markThreadRead(2, "T")).rejects.toBeInstanceOf(GoogleScopeMissingError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getCachedMessage(2, "m1")?.unread).toBe(true);
  });
});

describe("read access", () => {
  it("reads with whichever Gmail scope the account granted", async () => {
    await getLabel(1, "INBOX");
    await getLabel(2, "INBOX");
    expect(tokenRequests).toEqual([
      [1, [GMAIL_MODIFY]],
      [2, [GMAIL_READONLY]],
    ]);
  });

  it("reports which accounts can mark read", () => {
    expect(listMailAccounts().map((a) => [a.id, a.hasAccess, a.canMarkRead])).toEqual([
      [1, true, true],
      [2, true, false],
    ]);
  });
});
