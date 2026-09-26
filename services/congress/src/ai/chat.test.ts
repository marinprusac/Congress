import { sql } from "drizzle-orm";
import { migrationsDir } from "@congress/test-support";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunOutcome } from "./engine.js";

// The headless `claude` run itself - stubbed so these can control exactly
// when it resolves, to prove the user's message is visible in listMessages()
// *before* the run finishes, not only once it's paired with a reply.
const runAi = vi.fn();
vi.mock("./engine.js", () => ({ runAi: (...args: unknown[]) => runAi(...args) }));
const publishEvent = vi.fn();
vi.mock("../events.js", () => ({ publishEvent: (...args: unknown[]) => publishEvent(...args) }));

import { db, runMigrations } from "../db/client.js";
import { postChatMessage, listMessages } from "./chat.js";

beforeAll(() => runMigrations(migrationsDir("congress")));

beforeEach(() => {
  db.run(sql`delete from ai_messages`);
  runAi.mockReset();
  publishEvent.mockReset();
});

function outcome(overrides: Partial<RunOutcome> = {}): RunOutcome {
  return {
    ok: true,
    refused: false,
    response: "Done.",
    sessionId: "sess-1",
    errorMessage: null,
    transcript: [],
    costUsd: 0.01,
    inputTokens: null,
    outputTokens: null,
    durationMs: 10,
    ...overrides,
  };
}

describe("postChatMessage", () => {
  it("persists the user message immediately, before the queued run resolves", async () => {
    let resolveRun!: (value: RunOutcome) => void;
    runAi.mockReturnValue(new Promise((resolve) => (resolveRun = resolve)));

    const pending = postChatMessage({ text: "water the plants" });

    await vi.waitFor(() => expect(listMessages()).toHaveLength(1));
    expect(listMessages()[0]).toMatchObject({ role: "user", text: "water the plants" });

    resolveRun(outcome({ response: "Watered." }));
    const result = await pending;

    expect(result.assistantMessage.text).toBe("Watered.");
    expect(listMessages().map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("still records the user message when the run is refused", async () => {
    runAi.mockResolvedValue(outcome({ ok: false, refused: true, response: null, sessionId: null, errorMessage: "AI is paused." }));

    await postChatMessage({ text: "do a thing" });

    expect(listMessages().map((m) => m.text)).toEqual(["do a thing", "AI is paused."]);
  });

  it("resumes the previous session inside the idle window", async () => {
    runAi.mockResolvedValue(outcome({ sessionId: "sess-42" }));
    await postChatMessage({ text: "first" });
    await postChatMessage({ text: "follow-up" });

    expect(runAi.mock.calls[0]![0].resumeSessionId).toBeNull();
    expect(runAi.mock.calls[1]![0].resumeSessionId).toBe("sess-42");
    expect(runAi.mock.calls[1]![0]).toMatchObject({ kind: "chat", actor: "congress" });
  });

  it("publishes congress.ai_chat_run only when the chat actually called a tool", async () => {
    runAi.mockResolvedValue(outcome());
    await postChatMessage({ text: "just asking" });
    expect(publishEvent).not.toHaveBeenCalled();

    runAi.mockResolvedValue(outcome({ transcript: [{ toolName: "notes.create_note", input: {}, output: null, error: null }] }));
    await postChatMessage({ text: "make a note" });
    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(publishEvent.mock.calls[0]![0]).toMatchObject({ type: "congress.ai_chat_run", payload: { toolCallCount: 1 } });
  });
});
