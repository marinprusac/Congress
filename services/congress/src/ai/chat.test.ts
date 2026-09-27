import { sql } from "drizzle-orm";
import { migrationsDir } from "@congress/test-support";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunContext, RunOutcome } from "./engine.js";

const runAi = vi.fn<(ctx: RunContext) => Promise<RunOutcome>>();
vi.mock("./engine.js", () => ({ runAi: (ctx: RunContext) => runAi(ctx) }));
const publishEvent = vi.fn();
vi.mock("../events.js", () => ({ publishEvent: (...a: unknown[]) => publishEvent(...a) }));
const resolveExhibits = vi.fn();
const getCachedChamber = vi.fn((_id: string): string | null => null);
vi.mock("../exhibits.js", () => ({
  resolveExhibits: (...a: unknown[]) => resolveExhibits(...a),
  getCachedChamber: (id: string) => getCachedChamber(id),
}));

import { db, runMigrations } from "../db/client.js";
import { createThread, postMessage, recoverInterruptedThreads, repairInventedTokens, retryLast, ThreadBusyError } from "./chat.js";
import { cancelJob } from "./jobQueue.js";
import { getThread, getThreadRow, insertMessage, insertThread, listThreadMessages, plainSnippet, titleFromText, updateThreadRow } from "./threads.js";

function outcome(overrides: Partial<RunOutcome> = {}): RunOutcome {
  return {
    runId: "run",
    ok: true,
    refused: false,
    cancelled: false,
    response: "Hi there.",
    sessionId: "sess-1",
    errorMessage: null,
    transcript: [],
    activity: [],
    costUsd: 0.01,
    inputTokens: 1,
    outputTokens: 1,
    durationMs: 5,
    ...overrides,
  };
}

// Waits until the thread's queued run has settled.
async function settled(threadId: number): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (!getThreadRow(threadId)?.pendingRunId) return;
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error("run never settled");
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeAll(() => runMigrations(migrationsDir("congress")));

beforeEach(() => {
  db.run(sql`delete from ai_messages`);
  db.run(sql`delete from ai_threads`);
  runAi.mockReset();
  publishEvent.mockReset();
  resolveExhibits.mockReset();
});

describe("threaded chat", () => {
  it("stores the message and returns before the run finishes; the reply lands after", async () => {
    const run = deferred<RunOutcome>();
    runAi.mockImplementation((ctx) => run.promise.then((o) => ({ ...o, runId: ctx.runId ?? "x" })));

    const { thread, runId } = createThread({ text: "Plan my week please" });

    expect(runId).toBeTruthy();
    expect(getThread(thread.id)?.pendingRunId).toBe(runId);
    expect(thread.title).toBe("Plan my week please");
    expect(listThreadMessages(thread.id).messages.map((m) => m.role)).toEqual(["user"]);

    run.resolve(outcome());
    await settled(thread.id);

    const messages = listThreadMessages(thread.id).messages;
    expect(messages.map((m) => [m.role, m.status, m.text])).toEqual([
      ["user", "ok", "Plan my week please"],
      ["assistant", "ok", "Hi there."],
    ]);
    expect(getThreadRow(thread.id)?.sessionId).toBe("sess-1");
    expect(getThread(thread.id)?.unread).toBe(true);
  });

  it("refuses a second message while a reply is pending", async () => {
    const run = deferred<RunOutcome>();
    runAi.mockReturnValue(run.promise);
    const { thread } = createThread({ text: "one" });

    expect(() => postMessage(thread.id, "two")).toThrow(ThreadBusyError);
    run.resolve(outcome());
    await settled(thread.id);
  });

  it("resumes each thread's own session", async () => {
    runAi.mockResolvedValueOnce(outcome({ sessionId: "sess-a" })).mockResolvedValueOnce(outcome({ sessionId: "sess-b" }));
    const a = createThread({ text: "a" }).thread;
    await settled(a.id);
    const b = createThread({ text: "b" }).thread;
    await settled(b.id);

    runAi.mockResolvedValue(outcome({ sessionId: "sess-a" }));
    postMessage(a.id, "again");
    await settled(a.id);

    expect(runAi.mock.calls.map((c) => c[0].resumeSessionId)).toEqual([null, null, "sess-a"]);
    expect(runAi.mock.calls[2]?.[0]).toMatchObject({ threadId: a.id, kind: "chat" });
  });

  it("stores a refused run with refused status, not as an ordinary reply", async () => {
    runAi.mockResolvedValue(outcome({ ok: false, refused: true, response: null, sessionId: null, errorMessage: "AI is paused." }));
    const { thread } = createThread({ text: "hello" });
    await settled(thread.id);

    const reply = listThreadMessages(thread.id).messages.at(-1);
    expect(reply).toMatchObject({ role: "assistant", status: "refused", text: "AI is paused." });
  });

  it("records a stop before the run started as a cancelled reply", async () => {
    const blocker = deferred<RunOutcome>();
    runAi.mockReturnValueOnce(blocker.promise);
    const first = createThread({ text: "busy" });
    const second = createThread({ text: "queued" });

    expect(cancelJob(second.runId!)).toBe("queued");
    await settled(second.thread.id);
    blocker.resolve(outcome());
    await settled(first.thread.id);

    expect(listThreadMessages(second.thread.id).messages.at(-1)).toMatchObject({ status: "cancelled", text: "Stopped." });
  });

  it("starts a fresh session when the stored one no longer exists", async () => {
    const row = insertThread({ title: "Old" });
    updateThreadRow(row.id, { sessionId: "gone" });
    runAi
      .mockResolvedValueOnce(outcome({ ok: false, response: null, sessionId: null, errorMessage: "No conversation found with session ID: gone" }))
      .mockResolvedValueOnce(outcome({ sessionId: "fresh" }));

    postMessage(row.id, "hi");
    await settled(row.id);

    expect(runAi.mock.calls.map((c) => c[0].resumeSessionId)).toEqual(["gone", null]);
    expect(getThreadRow(row.id)?.sessionId).toBe("fresh");
    expect(listThreadMessages(row.id).messages.at(-1)?.status).toBe("ok");
  });

  it("retry replaces a failed reply with a new run of the same message", async () => {
    runAi.mockResolvedValueOnce(outcome({ ok: false, response: null, errorMessage: "boom" })).mockResolvedValueOnce(outcome());
    const { thread } = createThread({ text: "try me" });
    await settled(thread.id);
    expect(listThreadMessages(thread.id).messages.at(-1)?.status).toBe("error");

    retryLast(thread.id);
    await settled(thread.id);

    const messages = listThreadMessages(thread.id).messages;
    expect(messages.map((m) => [m.role, m.status])).toEqual([
      ["user", "ok"],
      ["assistant", "ok"],
    ]);
  });

  it("resolves referenced exhibits into the prompt", async () => {
    resolveExhibits.mockResolvedValue([{ id: "note-4", chamber: "notes", name: "Trip ideas", url: "/n/4" }]);
    runAi.mockResolvedValue(outcome());

    const { thread } = createThread({ text: "Summarise [[exhibit:notes:note-4|Trip]]" });
    await settled(thread.id);

    const body = runAi.mock.calls[0]?.[0].body ?? "";
    expect(body).toContain("## Exhibits referenced");
    expect(body).toContain('exhibit:notes:note-4 - "Trip ideas" (/n/4)');
    expect(thread.title).toBe("Summarise Trip");
  });

  it("publishes congress.ai_chat_run only when tools were used", async () => {
    runAi.mockResolvedValueOnce(outcome()).mockResolvedValueOnce(outcome({ transcript: [{ toolName: "x", input: {}, output: null, error: null }] }));
    const { thread } = createThread({ text: "no tools" });
    await settled(thread.id);
    postMessage(thread.id, "with tools");
    await settled(thread.id);

    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(publishEvent.mock.calls[0]?.[0]).toMatchObject({ type: "congress.ai_chat_run", payload: { message: "with tools" } });
  });

  it("marks runs cut off by a restart as interrupted", () => {
    const row = insertThread({});
    insertMessage({ threadId: row.id, role: "user", text: "hello" });
    updateThreadRow(row.id, { pendingRunId: "lost" });

    recoverInterruptedThreads();

    expect(getThreadRow(row.id)?.pendingRunId).toBeNull();
    expect(listThreadMessages(row.id).messages.at(-1)).toMatchObject({ status: "error" });
  });
});

describe("repairInventedTokens", () => {
  it("turns tokens nobody knows into plain labels, keeping real and deleted ones", async () => {
    resolveExhibits.mockResolvedValue([
      { id: "note-1", chamber: "notes", name: "Real", url: "/n/1" },
      { id: "Gym plan", chamber: "notes", deleted: true },
      { id: "note-9", chamber: "notes", deleted: true },
    ]);
    getCachedChamber.mockImplementation((id) => (id === "note-9" ? "notes" : null));
    const text = "[[exhibit:notes:note-1|Real]], [[exhibit:notes:Gym plan|Gym plan]] and | [[exhibit:notes:note-9\\|Old]] |";
    expect(await repairInventedTokens(text)).toBe("[[exhibit:notes:note-1|Real]], Gym plan and | [[exhibit:notes:note-9\\|Old]] |");
  });
});

describe("titleFromText", () => {
  it("uses exhibit labels and truncates on a word boundary", () => {
    expect(titleFromText("Look at [[exhibit:notes:n-1|Groceries]] now")).toBe("Look at Groceries now");
    expect(titleFromText("word ".repeat(30))).toMatch(/^(word ){5,}.*…$/);
  });
});

describe("plainSnippet", () => {
  it("flattens Markdown and chips into one readable line", () => {
    const table = "| Title | Summary |\n|-------|---------|\n| [[exhibit:notes:note-3\\|Standup]] | **Daily** notes |";
    expect(plainSnippet(table)).toBe("Title Summary Standup Daily notes");
    expect(plainSnippet("## Plan\n- [Docs](https://x.y) and `code`")).toBe("Plan Docs and code");
  });
});

describe("thread messages", () => {
  it("pages backwards and hides not-yet-delivered messages", () => {
    const row = insertThread({});
    for (let i = 0; i < 5; i++) insertMessage({ threadId: row.id, role: "user", text: `m${i}` });
    insertMessage({ threadId: row.id, role: "assistant", kind: "message", text: "later", deliverAt: new Date(Date.now() + 60_000) });

    const latest = listThreadMessages(row.id, { limit: 2 });
    expect(latest.messages.map((m) => m.text)).toEqual(["m3", "m4"]);
    expect(latest.hasMore).toBe(true);
    const older = listThreadMessages(row.id, { limit: 10, before: latest.messages[0]!.id });
    expect(older.messages.map((m) => m.text)).toEqual(["m0", "m1", "m2"]);
    expect(older.hasMore).toBe(false);
  });
});
