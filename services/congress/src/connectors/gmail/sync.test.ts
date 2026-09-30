import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runGmailMigrations } from "./db/client.js";
import { addressesOf, getAccountState, getThreadRow, skipPeople, toSourceRecord, unlinkedSentTo, updateSettings } from "./cache.js";
import { fakeGmail, msg, resetGmailCache } from "./fakeGmail.js";
import { syncAll } from "./sync.js";
import { threadDetail } from "./detail.js";
import { gmailConnector } from "./index.js";
import { GMAIL_READONLY } from "./api.js";
import { ConnectorRefusedError } from "../contract.js";

beforeAll(() => runGmailMigrations());
beforeEach(() => resetGmailCache());

describe("gmail sync", () => {
  it("backfills threads quietly and keeps the cursor", async () => {
    const { state, ctx } = fakeGmail();
    state.threads.t1 = [msg("m1", "t1", { subject: "Lunch?" }), msg("m2", "t1", { from: "Bob <bob@example.com>", hoursAgo: 0.1 })];
    state.threads.t2 = [msg("m3", "t2", { labels: ["SENT"], from: "me@example.com", to: "Ana <ana@example.com>" })];
    expect(await syncAll(ctx)).toEqual({ changed: 1, error: null });
    expect(getAccountState(1)?.historyId).toBe("100");
    expect(state.changes).toEqual([
      { kind: "thread", key: "1:t1", deleted: false, quiet: true },
      { kind: "thread", key: "1:t2", deleted: false, quiet: true },
    ]);
    expect(state.published).toEqual([]);
    const rec = toSourceRecord(getThreadRow("1:t1")!);
    expect(rec.values).toMatchObject({ subject: "Lunch?", from: "Bob <bob@example.com>", messageCount: 2, unread: true, inbox: true, category: "primary" });
    expect(rec.facts).toEqual({ canMarkRead: true });
  });

  it("refreshes threads history touches, and announces new mail only once allowed", async () => {
    const { state, ctx } = fakeGmail();
    state.threads.t1 = [msg("m1", "t1")];
    await syncAll(ctx);
    const grow = (id: string, labels?: string[]) => {
      state.threads.t1!.push(msg(id, "t1", { labels }));
      state.history.push({ messagesAdded: [{ message: { id, threadId: "t1", labelIds: labels ?? ["INBOX", "UNREAD"] } }] });
    };
    grow("m2");
    await syncAll(ctx);
    expect(getThreadRow("1:t1")!.messageCount).toBe(2);
    expect(state.published).toEqual([]);

    updateSettings({ publishEvents: true });
    state.records["1:t1"] = "rec1";
    grow("m3");
    grow("m4", ["SENT"]);
    await syncAll(ctx);
    expect(state.published.map((p) => p.payload.messageId)).toEqual(["m3"]);
    expect(state.published[0]).toMatchObject({ type: "mail.received", payload: { exhibitId: "rec1", url: "/e/rec1", from: "Jane Doe" } });
  });

  it("skips label changes on threads it doesn't keep, and drops a trashed thread", async () => {
    const { state, ctx } = fakeGmail();
    state.threads.t1 = [msg("m1", "t1")];
    await syncAll(ctx);
    state.history.push({ labelsAdded: [{ message: { id: "x", threadId: "old" } }] });
    state.threads.t1 = [msg("m1", "t1", { labels: ["TRASH"] })];
    state.history.push({ labelsAdded: [{ message: { id: "m1", threadId: "t1" } }] });
    state.calls = [];
    await syncAll(ctx);
    expect(state.calls.some((c) => c.url.includes("/threads/old"))).toBe(false);
    expect(getThreadRow("1:t1")).toBeUndefined();
    expect(state.changes.at(-1)).toEqual({ kind: "thread", key: "1:t1", deleted: true, quiet: false });
  });

  it("starts over when the history cursor expired", async () => {
    const { state, ctx } = fakeGmail();
    await syncAll(ctx);
    state.historyExpired = true;
    state.threads.t5 = [msg("m5", "t5")];
    await syncAll(ctx);
    expect(getThreadRow("1:t5")).toBeDefined();
  });
});

describe("people from mail", () => {
  it("creates People only from the To of mail the owner sent, once allowed", async () => {
    const { state, ctx } = fakeGmail();
    state.threads.t1 = [
      msg("m1", "t1", { from: "Ana <ana@example.com>", to: "me@example.com", cc: '"Doe, Carl" <carl@example.com>' }),
      msg("m2", "t1", { labels: ["SENT"], from: "me@example.com", to: "Ana <ana@example.com>, Bea <bea@example.com>", cc: "dan@example.com" }),
    ];
    state.people["carl@example.com"] = "person-carl";
    await syncAll(ctx);
    expect(state.resolved).toEqual([]);
    const rows = addressesOf("1:t1").sort((a, b) => a.email.localeCompare(b.email));
    expect(rows.map((a) => [a.email, a.name, a.sentTo, a.personId])).toEqual([
      ["ana@example.com", "Ana", true, null],
      ["bea@example.com", "Bea", true, null],
      ["carl@example.com", "Doe, Carl", false, "person-carl"],
      ["dan@example.com", null, false, null],
    ]);

    expect(unlinkedSentTo().map((a) => a.email).sort()).toEqual(["ana@example.com", "bea@example.com"]);
    skipPeople(["bea@example.com"]);
    updateSettings({ createPeople: true });
    await syncAll(ctx);
    expect(state.resolved).toEqual([{ email: "ana@example.com", evidence: "corresponded" }]);
    expect((toSourceRecord(getThreadRow("1:t1")!).values.people as string[]).sort()).toEqual(["person-ana@example.com", "person-carl"]);
    expect(state.found).not.toContain("me@example.com");
  });
});

describe("reading and marking read", () => {
  it("reads a thread live, plainly for the AI", async () => {
    const { state, ctx } = fakeGmail();
    state.threads.t1 = [msg("m1", "t1", { body: "Hi there\n\nOn Mon, Bob wrote:\n> old" })];
    const detail = await threadDetail(ctx, "1:t1", { ai: "1" });
    expect(detail).toMatchObject({ subject: "Subject t1", accountEmail: "me@example.com", messages: [{ messageId: "m1", html: null, text: "Hi there" }] });
  });

  it("marks a thread read with modify scope, and refuses without it", async () => {
    const { state, ctx } = fakeGmail();
    state.threads.t1 = [msg("m1", "t1")];
    await syncAll(ctx);
    const after = await gmailConnector.push!.act(ctx, "thread", "1:t1", "markRead", {});
    expect(after.values.unread).toBe(false);
    expect(state.calls.find((c) => c.method === "POST")?.url).toBe("/threads/t1/modify");

    state.accounts[0]!.scopes = [GMAIL_READONLY];
    await expect(gmailConnector.push!.act(ctx, "thread", "1:t1", "markRead", {})).rejects.toThrow(ConnectorRefusedError);
    state.calls = [];
    await syncAll(ctx);
    expect(state.calls.every((c) => c.scopes?.[0] === GMAIL_READONLY)).toBe(true);
  });

  it("forgets a disconnected account's threads", async () => {
    const { state, ctx } = fakeGmail();
    state.threads.t1 = [msg("m1", "t1")];
    await syncAll(ctx);
    gmailConnector.onEvent!(ctx, { chamber: "congress", type: "google.account_disconnected", payload: { accountId: 1 }, occurredAt: "" });
    expect(getThreadRow("1:t1")).toBeUndefined();
    expect(state.changes.at(-1)).toMatchObject({ key: "1:t1", deleted: true });
  });
});
