import { describe, expect, it } from "vitest";
import { mailFeedCandidates } from "./feedRules.js";
import type { MessageSummary } from "./types.js";

const now = new Date("2026-09-29T12:00:00Z");
const settings = { includeAllCategories: false, feedWindowHours: 24 };

let seq = 0;
function msg(overrides: Partial<MessageSummary> & { hoursAgo?: number } = {}): MessageSummary {
  const { hoursAgo = 1, ...rest } = overrides;
  const threadId = rest.threadId ?? `t${++seq}`;
  return {
    accountId: 1,
    messageId: `m${++seq}`,
    threadId,
    exhibitId: `thread-${rest.accountId ?? 1}:${threadId}`,
    from: { name: "Jane", email: "jane@example.com" },
    to: "me@example.com",
    subject: "Hello",
    snippet: "Just checking in",
    date: new Date(now.getTime() - hoursAgo * 3600_000).toISOString(),
    unread: true,
    inInbox: true,
    category: "primary",
    labelIds: ["INBOX", "UNREAD"],
    hasAttachments: false,
    url: `/t/1/${threadId}`,
    ...rest,
  };
}

const oneAccount = new Map([[1, "Personal"]]);

describe("mailFeedCandidates", () => {
  it("shows an unread primary thread with its content inline", () => {
    const [item] = mailFeedCandidates([msg({ subject: "Lunch?", hoursAgo: 2 })], settings, oneAccount, now);
    expect(item).toMatchObject({
      kind: "exhibit",
      reason: "Unread · 2 h ago",
      preview: { title: "Lunch?", fields: ["Jane"], body: "Just checking in", time: { label: "Received" } },
    });
  });

  it("skips read, archived, sent, stale and non-primary mail", () => {
    const items = mailFeedCandidates(
      [
        msg({ unread: false }),
        msg({ inInbox: false }),
        msg({ labelIds: ["INBOX", "UNREAD", "SENT"] }),
        msg({ hoursAgo: 30 }),
        msg({ category: "promotions" }),
      ],
      settings,
      oneAccount,
      now
    );
    expect(items).toEqual([]);
  });

  it("includes every category when the owner opts in", () => {
    const items = mailFeedCandidates([msg({ category: "promotions" })], { ...settings, includeAllCategories: true }, oneAccount, now);
    expect(items).toHaveLength(1);
  });

  it("collapses a thread to one item and counts its unread messages", () => {
    const items = mailFeedCandidates(
      [msg({ threadId: "x", hoursAgo: 1, subject: "Re: plan" }), msg({ threadId: "x", hoursAgo: 3 })],
      settings,
      oneAccount,
      now
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ preview: { title: "Re: plan", fields: ["Jane", "2 unread"] } });
  });

  it("ranks newer and important mail higher, and names the account when there are several", () => {
    const items = mailFeedCandidates(
      [msg({ hoursAgo: 20, subject: "old" }), msg({ hoursAgo: 1, subject: "new" }), msg({ hoursAgo: 20, subject: "vip", labelIds: ["INBOX", "UNREAD", "IMPORTANT"] })],
      settings,
      new Map([
        [1, "Personal"],
        [2, "Work"],
      ]),
      now
    );
    expect(items.map((i) => i.kind === "exhibit" && i.preview?.title)).toEqual(["new", "vip", "old"]);
    expect(items[0]).toMatchObject({ preview: { fields: ["Jane", "Personal"] } });
    expect(items[1]).toMatchObject({ reason: "Important, unread" });
  });
});
