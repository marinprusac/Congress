import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runGmailMigrations } from "./db/client.js";
import { getAccountState, updateSettings } from "./cache.js";
import { fakeGmail, msg, resetGmailCache } from "./fakeGmail.js";
import { syncAll } from "./sync.js";
import { searchThreads, threadDetail } from "./detail.js";
import { gmailConnector } from "./index.js";
import { GMAIL_READONLY } from "./api.js";

beforeAll(() => runGmailMigrations());
beforeEach(() => resetGmailCache());

describe("gmail sync", () => {
  it("only takes the history cursor the first time: no records, no events", async () => {
    const { state, ctx } = fakeGmail();
    state.threads.t1 = [msg("m1", "t1", { subject: "Lunch?" })];
    expect(await syncAll(ctx)).toEqual({ changed: 1, error: null });
    expect(getAccountState(1)?.historyId).toBe("100");
    expect(state.changes).toEqual([]);
    expect(state.published).toEqual([]);
    expect(state.calls.filter((c) => c.url.startsWith("/threads"))).toEqual([]);
  });

  it("announces new inbox mail only once allowed, never stores it, and emits no source changes", async () => {
    const { state, ctx } = fakeGmail();
    state.threads.t1 = [msg("m1", "t1")];
    await syncAll(ctx);
    const grow = (id: string, labels?: string[]) => {
      state.threads.t1!.push(msg(id, "t1", { labels }));
      state.history.push({ messagesAdded: [{ message: { id, threadId: "t1", labelIds: labels ?? ["INBOX", "UNREAD"] } }] });
    };
    grow("m2");
    await syncAll(ctx);
    expect(state.published).toEqual([]);

    updateSettings({ publishEvents: true });
    grow("m3");
    grow("m4", ["SENT"]);
    grow("m5", ["INBOX", "UNREAD", "CATEGORY_PROMOTIONS"]);
    await syncAll(ctx);
    expect(state.published.map((p) => p.payload.messageId)).toEqual(["m3"]);
    expect(state.published[0]).toMatchObject({
      type: "mail.received",
      payload: { threadId: "t1", from: "Jane Doe", url: "https://mail.google.com/mail/u/me%40example.com/#all/t1" },
    });
    expect(state.published[0]!.payload).not.toHaveProperty("recordId");
    expect(state.changes).toEqual([]);

    updateSettings({ includeAllCategories: true });
    grow("m6", ["INBOX", "UNREAD", "CATEGORY_PROMOTIONS"]);
    await syncAll(ctx);
    expect(state.published.map((p) => p.payload.messageId)).toEqual(["m3", "m6"]);
  });

  it("starts over when the history cursor expired", async () => {
    const { state, ctx } = fakeGmail();
    await syncAll(ctx);
    state.historyId = "200";
    state.historyExpired = true;
    await syncAll(ctx);
    expect(getAccountState(1)?.historyId).toBe("200");
  });

  it("offers no source kinds and no writes", () => {
    expect(gmailConnector.source).toEqual([]);
    expect(gmailConnector.push).toBeUndefined();
    expect(gmailConnector.read.list("thread")).toEqual([]);
  });
});

describe("reading live", () => {
  it("reads a thread plainly for the AI", async () => {
    const { state, ctx } = fakeGmail();
    state.threads.t1 = [msg("m1", "t1", { body: "Hi there\n\nOn Mon, Bob wrote:\n> old" })];
    const detail = await threadDetail(ctx, "1:t1");
    expect(detail).toMatchObject({ subject: "Subject t1", accountEmail: "me@example.com", messages: [{ messageId: "m1", text: "Hi there" }] });
    expect(detail.messages[0]).not.toHaveProperty("html");
  });

  it("searches live and lists who's on the thread, marking who the owner wrote to; nothing is cached", async () => {
    const { state, ctx } = fakeGmail();
    state.threads.t1 = [
      msg("m1", "t1", { from: "Ana <ana@example.com>", to: "me@example.com", cc: '"Doe, Carl" <carl@example.com>' }),
      msg("m2", "t1", { labels: ["SENT"], from: "me@example.com", to: "Ana <ana@example.com>, Bea <bea@example.com>", cc: "dan@example.com" }),
    ];
    const [hit] = await searchThreads(ctx, "anything", 5);
    expect(hit).toMatchObject({ key: "1:t1", subject: "Subject t1", messageCount: 2, account: "me@example.com" });
    expect([...hit!.people].sort()).toEqual([
      "Ana <ana@example.com> (you wrote to them)",
      "Bea <bea@example.com> (you wrote to them)",
      "Doe, Carl <carl@example.com>",
      "dan@example.com",
    ]);
    expect(state.resolved).toEqual([]);
    expect(state.found).toEqual([]);
  });

  it("only ever reads: every call is a GET with a read scope", async () => {
    const { state, ctx } = fakeGmail();
    state.accounts[0]!.scopes = [GMAIL_READONLY];
    state.threads.t1 = [msg("m1", "t1")];
    await syncAll(ctx);
    await searchThreads(ctx, "x", 5);
    await threadDetail(ctx, "1:t1");
    expect(state.calls.every((c) => c.method === "GET" && c.scopes?.[0] === GMAIL_READONLY)).toBe(true);
  });

  it("forgets a disconnected account's cursor", async () => {
    const { ctx } = fakeGmail();
    await syncAll(ctx);
    gmailConnector.onEvent!(ctx, { chamber: "congress", type: "google.account_disconnected", payload: { accountId: 1 }, occurredAt: "" });
    expect(getAccountState(1)).toBeUndefined();
  });
});
