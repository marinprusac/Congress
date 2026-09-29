import { migrationsDir } from "@congress/test-support";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./events.js", () => ({ publishEvent: vi.fn() }));
vi.mock("./gmail/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./gmail/client.js")>()),
  getProfile: vi.fn(),
  listMessageIds: vi.fn(),
  getMessageMetadata: vi.fn(),
  listHistory: vi.fn(),
}));

import { db, runMigrations } from "./db/client.js";
import { publishEvent } from "./events.js";
import { GmailApiError, getMessageMetadata, getProfile, listHistory, listMessageIds } from "./gmail/client.js";
import type { RawGmailMessage } from "./gmail/mime.js";
import { getCachedMessage, listCachedMessages, parseThreadExhibitId, searchCachedThreads, threadExhibitId, forgetAccount } from "./cache.js";
import { getSyncState, syncAccount } from "./sync.js";
import { updateSettings } from "./settings.js";

const now = new Date("2026-09-29T12:00:00Z");
const store = new Map<string, RawGmailMessage>();

function gmailMessage(id: string, opts: { threadId?: string; labels?: string[]; subject?: string; from?: string; hoursAgo?: number } = {}): RawGmailMessage {
  const raw: RawGmailMessage = {
    id,
    threadId: opts.threadId ?? `t-${id}`,
    labelIds: opts.labels ?? ["INBOX", "UNREAD", "CATEGORY_PERSONAL"],
    snippet: `snippet ${id}`,
    internalDate: String(now.getTime() - (opts.hoursAgo ?? 0.5) * 3600_000),
    payload: {
      mimeType: "multipart/alternative",
      headers: [
        { name: "From", value: opts.from ?? "Jane Doe <jane@example.com>" },
        { name: "Subject", value: opts.subject ?? `Subject ${id}` },
      ],
    },
  };
  store.set(id, raw);
  return raw;
}

function added(raw: RawGmailMessage) {
  return { message: { id: raw.id, threadId: raw.threadId, labelIds: raw.labelIds } };
}

beforeAll(() => runMigrations(migrationsDir("chamber-mail")));

beforeEach(() => {
  db.run("delete from messages");
  db.run("delete from sync_state");
  store.clear();
  vi.mocked(publishEvent).mockReset();
  vi.mocked(listHistory).mockReset();
  vi.mocked(getProfile).mockResolvedValue({ emailAddress: "me@example.com", messagesTotal: 0, threadsTotal: 0, historyId: "100" });
  vi.mocked(getMessageMetadata).mockImplementation(async (_a, id) => {
    const raw = store.get(id);
    if (!raw) throw new GmailApiError(404, "gone");
    return raw;
  });
  vi.mocked(listMessageIds).mockImplementation(async () => ({ ids: [...store.values()].map((m) => ({ id: m.id, threadId: m.threadId })) }));
});

async function backfilled(): Promise<void> {
  await syncAccount(1, "me@example.com", now);
}

describe("first sync", () => {
  it("backfills recent mail without announcing it", async () => {
    gmailMessage("a");
    gmailMessage("b", { labels: ["SENT"] });
    await backfilled();
    expect(listCachedMessages({ inboxOnly: false }).map((m) => m.messageId).sort()).toEqual(["a", "b"]);
    expect(getSyncState(1)).toMatchObject({ historyId: "100", lastError: null });
    expect(publishEvent).not.toHaveBeenCalled();
  });
});

describe("incremental sync", () => {
  beforeEach(async () => {
    gmailMessage("old", { subject: "Old one" });
    await backfilled();
  });

  it("announces new primary inbox mail and caches everything new", async () => {
    const fresh = gmailMessage("n1", { subject: "Dinner?" });
    const promo = gmailMessage("n2", { labels: ["INBOX", "UNREAD", "CATEGORY_PROMOTIONS"] });
    const draft = gmailMessage("n3", { labels: ["DRAFT"] });
    vi.mocked(listHistory).mockResolvedValue({ history: [{ id: "101", messagesAdded: [added(fresh), added(promo), added(draft)] }], historyId: "105" });

    await syncAccount(1, "me@example.com", now);

    expect(getCachedMessage(1, "n1")).toBeDefined();
    expect(getCachedMessage(1, "n2")).toBeDefined();
    expect(getCachedMessage(1, "n3")).toBeUndefined();
    expect(getSyncState(1)?.historyId).toBe("105");
    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(publishEvent).mock.calls[0]![0]).toMatchObject({
      type: "mail.received",
      payload: { accountId: 1, messageId: "n1", subject: "Dinner?", from: "Jane Doe", fromEmail: "jane@example.com", exhibitId: threadExhibitId(1, "t-n1"), url: "/t/1/t-n1" },
    });
  });

  it("announces other categories once the owner opts in", async () => {
    await updateSettings({ includeAllCategories: true });
    const promo = gmailMessage("p", { labels: ["INBOX", "UNREAD", "CATEGORY_PROMOTIONS"] });
    vi.mocked(listHistory).mockResolvedValue({ history: [{ id: "101", messagesAdded: [added(promo)] }], historyId: "102" });
    await syncAccount(1, "me@example.com", now);
    expect(publishEvent).toHaveBeenCalledTimes(1);
    await updateSettings({ includeAllCategories: false });
  });

  it("doesn't announce own sent mail or old mail resurfacing", async () => {
    const sent = gmailMessage("s", { labels: ["INBOX", "SENT"] });
    const resurfaced = gmailMessage("r", { hoursAgo: 72 });
    vi.mocked(listHistory).mockResolvedValue({ history: [{ id: "101", messagesAdded: [added(sent), added(resurfaced)] }], historyId: "102" });
    await syncAccount(1, "me@example.com", now);
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it("applies label changes, trash and deletes to the cache", async () => {
    gmailMessage("x");
    gmailMessage("y");
    vi.mocked(listHistory).mockResolvedValueOnce({ history: [{ id: "101", messagesAdded: [added(store.get("x")!), added(store.get("y")!)] }], historyId: "102" });
    await syncAccount(1, "me@example.com", now);

    vi.mocked(listHistory).mockResolvedValueOnce({
      history: [
        { id: "103", labelsRemoved: [{ message: { id: "old", threadId: "t-old", labelIds: ["INBOX"] } }] },
        { id: "104", labelsAdded: [{ message: { id: "x", threadId: "t-x", labelIds: ["TRASH"] } }] },
        { id: "105", messagesDeleted: [{ message: { id: "y", threadId: "t-y" } }] },
      ],
      historyId: "105",
    });
    await syncAccount(1, "me@example.com", now);

    expect(getCachedMessage(1, "old")).toMatchObject({ unread: false, inInbox: true });
    expect(getCachedMessage(1, "x")).toBeUndefined();
    expect(getCachedMessage(1, "y")).toBeUndefined();
  });

  it("re-backfills when Gmail says the cursor is too old", async () => {
    vi.mocked(listHistory).mockRejectedValue(new GmailApiError(404, "expired"));
    vi.mocked(getProfile).mockResolvedValue({ emailAddress: "me@example.com", messagesTotal: 0, threadsTotal: 0, historyId: "900" });
    await syncAccount(1, "me@example.com", now);
    expect(getSyncState(1)).toMatchObject({ historyId: "900", lastError: null });
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it("records the error and keeps the cursor on failure", async () => {
    vi.mocked(listHistory).mockRejectedValue(new GmailApiError(500, "boom"));
    await expect(syncAccount(1, "me@example.com", now)).rejects.toThrow();
    expect(getSyncState(1)).toMatchObject({ historyId: "100" });
    expect(getSyncState(1)?.lastError).toContain("500");
  });
});

describe("cache", () => {
  it("round-trips thread exhibit ids", () => {
    expect(parseThreadExhibitId(threadExhibitId(3, "18c2f0a9b"))).toEqual({ accountId: 3, threadId: "18c2f0a9b" });
    expect(parseThreadExhibitId("note-3")).toBeNull();
  });

  it("searches per thread, newest message first", async () => {
    gmailMessage("a1", { threadId: "T", subject: "Budget review", hoursAgo: 3 });
    gmailMessage("a2", { threadId: "T", subject: "Re: Budget review", hoursAgo: 1 });
    gmailMessage("b1", { subject: "Unrelated" });
    await backfilled();
    const hits = searchCachedThreads("budget");
    expect(hits.map((h) => h.messageId)).toEqual(["a2"]);
  });

  it("forgets a disconnected account", async () => {
    gmailMessage("a");
    await backfilled();
    forgetAccount(1);
    expect(listCachedMessages({ inboxOnly: false })).toEqual([]);
    expect(getSyncState(1)).toBeUndefined();
  });
});
