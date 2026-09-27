import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import { serve, type ServerType } from "@hono/node-server";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMcpApp, mcpTextResult } from "@congress/chamber-kit";
import { makeManifest, migrationsDir, TEST_INTERNAL_TOKEN } from "@congress/test-support";
import type { RunContext, RunOutcome } from "./engine.js";

const runAi = vi.fn<(ctx: RunContext) => Promise<RunOutcome>>();
vi.mock("./engine.js", () => ({ runAi: (ctx: RunContext) => runAi(ctx) }));

import { db, runMigrations } from "../db/client.js";
import { registerChamber } from "../registry.js";
import { updateAiSettings } from "./settings.js";
import {
  AskClosedError,
  AskInvalidError,
  answerQuestion,
  askQuestion,
  decideProposal,
  listAsksForAi,
  listOpenAsks,
  normalizeToolName,
  unescapeNewlines,
  proposeActions,
  runAskTimerTick,
  sendMessage,
  withdrawAsk,
} from "./asks.js";
import { getMessage, getThreadRow, insertMessage, insertThread, listThreadMessages } from "./threads.js";

function outcome(): RunOutcome {
  return {
    runId: "r",
    ok: true,
    refused: false,
    cancelled: false,
    response: "Noted.",
    sessionId: "s",
    errorMessage: null,
    transcript: [],
    activity: [],
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 1,
  };
}

// Retries an assertion until it holds (for fire-and-forget work).
async function eventually(assertion: () => void, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return assertion();
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}

const notificationRows = () => db.all<{ dedupe_key: string }>(sql`select dedupe_key from notifications`);

// A real MCP server the proposals call into.
const calls: { tool: string; args: unknown; actor?: string }[] = [];
let server: ServerType;
beforeAll(async () => {
  runMigrations(migrationsDir("congress"));
  const mcp = createMcpApp(
    "tasks",
    (s) => {
      s.registerTool("create_task", { title: "Create", description: "", inputSchema: { title: z.string() } }, async ({ title }) => {
        calls.push({ tool: "create_task", args: { title } });
        return mcpTextResult({ id: 7, title });
      });
      s.registerTool("explode", { title: "Explode", description: "", inputSchema: {} }, async () => ({
        isError: true,
        content: [{ type: "text" as const, text: "boom" }],
      }));
    },
    TEST_INTERNAL_TOKEN
  );
  const { Hono } = await import("hono");
  const app = new Hono();
  app.route("/mcp", mcp);
  server = await new Promise<ServerType>((resolve) => {
    const s = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, () => resolve(s));
  });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  registerChamber(makeManifest("tasks", { mcpUrl: `${origin}/mcp` }));
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(async () => {
  db.run(sql`delete from ai_messages`);
  db.run(sql`delete from ai_threads`);
  db.run(sql`delete from notifications`);
  db.run(sql`delete from ai_settings`);
  await updateAiSettings({ quietHoursStart: null, quietHoursEnd: null, maxPushesPerDay: 2 });
  runAi.mockReset();
  runAi.mockResolvedValue(outcome());
  calls.length = 0;
});

describe("where asks land", () => {
  it("goes into the calling run's thread", async () => {
    const thread = insertThread({ title: "Chat" });
    const { message } = await sendMessage({ body: "FYI", urgency: "quiet" }, { runId: "r1", threadId: thread.id });
    expect(message.threadId).toBe(thread.id);
  });

  it("opens one unread AI thread per run when there is no thread", async () => {
    const a = await sendMessage({ title: "Heads up", body: "one", urgency: "quiet" }, { runId: "run-x", threadId: null });
    const b = await sendMessage({ body: "two", urgency: "quiet" }, { runId: "run-x", threadId: null });
    const c = await sendMessage({ body: "three", urgency: "quiet" }, { runId: "run-y", threadId: null });
    expect(a.message.threadId).toBe(b.message.threadId);
    expect(c.message.threadId).not.toBe(a.message.threadId);
    const thread = getThreadRow(a.message.threadId);
    expect(thread).toMatchObject({ origin: "ai", title: "Heads up", lastReadAt: null });
  });
});

describe("delivery and pushes", () => {
  it("always adds an inbox entry, and pushes only within the daily cap", async () => {
    const results = [];
    for (let i = 0; i < 3; i++) results.push((await sendMessage({ body: `m${i}`, urgency: "push" }, { runId: null, threadId: null })).delivery);
    expect(results).toEqual(["push", "push", "over_cap"]);
    expect(notificationRows()).toHaveLength(3);
    expect((await listAsksForAi()).pushesLeftToday).toBe(0);
  });

  it("never pushes in quiet hours", async () => {
    await updateAiSettings({ quietHoursStart: 0, quietHoursEnd: 23, timeZone: "UTC" });
    const { delivery } = await sendMessage({ body: "late", urgency: "push" }, { runId: null, threadId: null });
    // Hour 23 UTC is outside [0, 23); anything else is inside.
    expect(delivery === "quiet_hours" || new Date().getUTCHours() === 23).toBe(true);
  });

  it("holds a reminder until its time, then delivers it", async () => {
    const thread = insertThread({});
    const at = new Date(Date.now() + 60_000);
    const { message, delivery } = await sendMessage({ body: "Call mum", urgency: "quiet", deliverAt: at }, { runId: null, threadId: thread.id });
    expect(delivery).toBe("scheduled");
    expect(listThreadMessages(thread.id).messages).toHaveLength(0);
    expect(notificationRows()).toHaveLength(0);

    insertMessage({ threadId: thread.id, role: "user", text: "meanwhile" });
    await runAskTimerTick(new Date(at.getTime() + 1000));
    // Delivered at the end of the thread, after what was said in between.
    const rows = listThreadMessages(thread.id).messages;
    expect(rows.map((m) => m.text)).toEqual(["meanwhile", "Call mum"]);
    const delivered = rows.at(-1)!;
    expect(delivered.id).not.toBe(message.id);
    expect(notificationRows().map((r) => r.dedupe_key)).toEqual([`ask-${delivered.id}`]);
  });

  it("cancels an undelivered reminder but won't unsend a delivered message", async () => {
    const later = await sendMessage({ body: "later", urgency: "quiet", deliverAt: new Date(Date.now() + 60_000) }, { runId: null, threadId: null });
    withdrawAsk(later.message.id);
    expect(getMessage(later.message.id)).toBeNull();
    const now = await sendMessage({ body: "now", urgency: "quiet" }, { runId: null, threadId: null });
    expect(() => withdrawAsk(now.message.id)).toThrow(AskClosedError);
  });
});

describe("questions", () => {
  const fields = [
    { key: "slot", label: "When", type: "choice" as const, required: true, options: [{ value: "am", label: "Morning" }, { value: "pm", label: "Evening" }] },
    { key: "note", label: "Anything else", type: "text" as const },
  ];

  it("rejects a malformed form with a precise message", () => {
    expect(() => askQuestion({ title: "Q", prompt: "?", fields: [], urgency: "quiet" }, { runId: null, threadId: null })).toThrow(AskInvalidError);
  });

  it("validates answers, records them and continues in the thread", async () => {
    const thread = insertThread({});
    const { message } = await askQuestion({ title: "Gym time", prompt: "When tomorrow?", fields, urgency: "quiet" }, { runId: null, threadId: thread.id });
    expect(listOpenAsks().map((a) => a.messageId)).toContain(message.id);

    try {
      answerQuestion(message.id, { slot: "noon" });
      throw new Error("expected invalid");
    } catch (err) {
      expect(err).toBeInstanceOf(AskInvalidError);
      expect((err as AskInvalidError).fieldErrors).toHaveProperty("slot");
    }

    answerQuestion(message.id, { slot: "pm", note: "" });
    expect(getMessage(message.id)).toMatchObject({ askState: "answered", payload: { answer: { slot: "pm", note: null } } });
    const rows = listThreadMessages(thread.id).messages;
    expect(rows.at(-1)).toMatchObject({ role: "user", kind: "answer" });
    expect(rows.at(-1)?.text).toContain("**When:** Evening");
    expect(notificationRows()).toHaveLength(0);
    await eventually(() => expect(runAi).toHaveBeenCalledTimes(1));
    expect(runAi.mock.calls[0]?.[0]).toMatchObject({ kind: "answer", threadId: thread.id });
    expect(runAi.mock.calls[0]?.[0].body).toContain("Evening");
    expect(() => answerQuestion(message.id, { slot: "am" })).toThrow(AskClosedError);
  });

  it("expires an unanswered question", async () => {
    const { message } = await askQuestion(
      { title: "Q", prompt: "?", fields, urgency: "quiet", expiresAt: new Date(Date.now() + 1000) },
      { runId: null, threadId: null }
    );
    await runAskTimerTick(new Date(Date.now() + 5000));
    expect(getMessage(message.id)?.askState).toBe("expired");
  });
});

describe("proposals", () => {
  it("refuses a proposal targeting an unknown server", () => {
    expect(() =>
      proposeActions({ title: "X", rationale: "y", urgency: "quiet", actions: [{ server: "nope", tool: "t", args: {}, summary: "s" }] }, { runId: null, threadId: null })
    ).toThrow(/Unknown or offline/);
  });

  it("executes exactly the approved calls against the Chamber and reports back", async () => {
    const thread = insertThread({});
    const { message } = await proposeActions(
      { title: "Add task", rationale: "You mentioned it", urgency: "quiet", actions: [{ server: "tasks", tool: "mcp__tasks__create_task", args: { title: "Renew car" }, summary: "Create 'Renew car'" }] },
      { runId: null, threadId: thread.id }
    );
    decideProposal(message.id, true);
    await eventually(() => expect(getMessage(message.id)?.askState).toBe("executed"));
    expect(calls).toEqual([{ tool: "create_task", args: { title: "Renew car" } }]);
    expect((getMessage(message.id)?.payload as { results: { ok: boolean }[] }).results).toEqual([expect.objectContaining({ ok: true })]);
    await eventually(() => expect(runAi).toHaveBeenCalled());
    expect(runAi.mock.calls.at(-1)?.[0].body).toContain("approved");
  });

  it("stops at the first failing call and skips the rest", async () => {
    const { message } = await proposeActions(
      {
        title: "Two steps",
        rationale: "r",
        urgency: "quiet",
        actions: [
          { server: "tasks", tool: "explode", args: {}, summary: "fails" },
          { server: "tasks", tool: "create_task", args: { title: "never" }, summary: "skipped" },
        ],
      },
      { runId: null, threadId: null }
    );
    decideProposal(message.id, true);
    await eventually(() => expect(getMessage(message.id)?.askState).toBe("failed"));
    const results = (getMessage(message.id)?.payload as { results: { ok: boolean; error: string | null }[] }).results;
    expect(results.map((r) => r.ok)).toEqual([false, false]);
    expect(results[1]?.error).toMatch(/Skipped/);
    expect(calls).toEqual([]);
  });

  it("records a rejection with the owner's note and runs nothing", async () => {
    const { message } = await proposeActions(
      { title: "Delete", rationale: "r", urgency: "quiet", actions: [{ server: "tasks", tool: "create_task", args: { title: "x" }, summary: "s" }] },
      { runId: null, threadId: null }
    );
    decideProposal(message.id, false, "Not now");
    expect(getMessage(message.id)).toMatchObject({ askState: "rejected", payload: { note: "Not now" } });
    await eventually(() => expect(runAi).toHaveBeenCalled());
    expect(runAi.mock.calls.at(-1)?.[0].body).toContain("Not now");
    expect(calls).toEqual([]);
  });

  it("repairs double-escaped newlines but leaves real ones alone", () => {
    expect(unescapeNewlines("Three tasks:\\n\\n• A")).toBe("Three tasks:\n\n• A");
    expect(unescapeNewlines("Line\nwith \\n literal")).toBe("Line\nwith \\n literal");
  });

  it("strips the CLI's mcp__server__ prefix from tool names", () => {
    expect(normalizeToolName("tasks", "mcp__tasks__create_task")).toBe("create_task");
    expect(normalizeToolName("tasks", "create_task")).toBe("create_task");
  });
});
