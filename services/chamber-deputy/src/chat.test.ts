import { sql } from "drizzle-orm";
import { migrationsDir } from "@congress/test-support";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The headless `claude` run itself - stubbed so these can control exactly
// when it resolves, to prove the user's message is visible in listMessages()
// *before* the run finishes, not only once it's paired with a reply.
const runDeputy = vi.fn();
vi.mock("./engine.js", () => ({ runDeputy: (...args: unknown[]) => runDeputy(...args) }));

import { db, runMigrations } from "./db/client.js";
import { postChatMessage, listMessages } from "./chat.js";

beforeAll(() => runMigrations(migrationsDir("chamber-deputy")));

beforeEach(() => {
  db.run(sql`delete from messages`);
  runDeputy.mockReset();
});

describe("postChatMessage", () => {
  it("persists the user message immediately, before the queued run resolves", async () => {
    // Regression: the user row and the assistant reply used to be inserted
    // together in one call, only after runDeputy resolved - a page refresh
    // while a run was still in flight found no trace of the just-sent
    // message at all, since ChatPage's own optimistic cache entry lives only
    // in the browser's memory.
    let resolveRun!: (value: unknown) => void;
    runDeputy.mockReturnValue(new Promise((resolve) => (resolveRun = resolve)));

    const pending = postChatMessage({ text: "water the plants" });

    await vi.waitFor(async () => {
      const rows = await listMessages();
      expect(rows).toHaveLength(1);
    });
    const midFlight = await listMessages();
    expect(midFlight[0]?.role).toBe("user");
    expect(midFlight[0]?.text).toBe("water the plants");

    resolveRun({ ok: true, response: "Watered.", sessionId: "sess-1", errorMessage: null, costUsd: 0.01 });
    const result = await pending;

    expect(result.userMessage.text).toBe("water the plants");
    expect(result.assistantMessage.text).toBe("Watered.");

    const rows = await listMessages();
    expect(rows).toHaveLength(2);
    expect(rows[0]?.role).toBe("user");
    expect(rows[1]?.role).toBe("assistant");
  });

  it("still records the user message even when the run itself fails", async () => {
    runDeputy.mockResolvedValue({ ok: false, response: null, sessionId: null, errorMessage: "Deputy is paused.", costUsd: null });

    await postChatMessage({ text: "do a thing" });

    const rows = await listMessages();
    expect(rows).toHaveLength(2);
    expect(rows[0]?.text).toBe("do a thing");
    expect(rows[1]?.text).toBe("Deputy is paused.");
  });
});
