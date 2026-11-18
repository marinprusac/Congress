import { sql } from "drizzle-orm";
import { migrationsDir } from "@congress/test-support";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunOutcome } from "./engine.js";

vi.mock("./engine.js", () => ({ runAi: vi.fn() }));

import { db, runMigrations } from "../db/client.js";
import { runRecordsMigrations } from "../typeEngine/db/client.js";
import { getTypeBySlug, publish } from "../typeEngine/store.js";
import { createRecord, updateRecord } from "../typeEngine/records.js";
import { publishEvent } from "../events.js";
import { updateAiSettings } from "./settings.js";
import { linkPromptBody, maybeLink, pendingLinks, queueLink, resetLinker, settle, SETTLE_MS, shouldQueueWrite, startLinker, stopLinker, MAX_ATTEMPTS } from "./linker.js";

function outcome(overrides: Partial<RunOutcome> = {}): RunOutcome {
  return {
    runId: "r",
    ok: true,
    refused: false,
    cancelled: false,
    response: "Linked.",
    sessionId: null,
    errorMessage: null,
    transcript: [],
    activity: [],
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 1,
    ...overrides,
  };
}

const T0 = Date.parse("2026-11-18T12:00:00Z");
const later = T0 + SETTLE_MS + 1;

beforeAll(() => {
  runMigrations(migrationsDir("congress"));
  runRecordsMigrations();
  publish({
    actor: "test",
    ops: [
      { op: "create_type", slug: "memo", label: "Memo" },
      { op: "add_field", slug: "title", label: "Title", kind: "text", options: { required: true } },
      { op: "set_title_field", field: "title" },
      { op: "add_field", slug: "body", label: "Body", kind: "text" },
    ],
  });
});

beforeEach(async () => {
  db.run(sql`delete from ai_link_queue`);
  db.run(sql`delete from ai_settings`);
  await updateAiSettings({ linkerEnabled: true, linkerIntervalMinutes: 15 });
  resetLinker();
});

describe("what the linker queues", () => {
  const memo = () => getTypeBySlug("memo")!;

  it("queues creates by anyone but the AI, and only the owner's edits", () => {
    expect(shouldQueueWrite(memo(), { op: "create", changed: [], actor: "me" })).toBe(true);
    expect(shouldQueueWrite(memo(), { op: "create", changed: [], fromSource: true })).toBe(true);
    expect(shouldQueueWrite(memo(), { op: "create", changed: [], actor: "congress" })).toBe(false);
    expect(shouldQueueWrite(memo(), { op: "create", changed: [], quiet: true })).toBe(false);
    expect(shouldQueueWrite(memo(), { op: "update", changed: [], actor: "me" })).toBe(true);
    expect(shouldQueueWrite(memo(), { op: "update", changed: [], fromSource: true })).toBe(false);
    expect(shouldQueueWrite(memo(), { op: "update", changed: [], actor: "congress" })).toBe(false);
    expect(shouldQueueWrite(memo(), { op: "delete", changed: [], actor: "me" })).toBe(false);
  });

  it("collects record writes and new WhatsApp contacts once each", () => {
    startLinker();
    try {
      const rec = createRecord("memo", { title: "Lunch with Ana" }, { actor: "me" });
      updateRecord(rec.id, { body: "Friday" }, { actor: "me" });
      createRecord("memo", { title: "From the AI" }, { actor: "congress" });
      publishEvent({ chamber: "whatsapp", type: "whatsapp.new_contact", payload: { jid: "385@s.whatsapp.net", phone: "+385", name: "Ana", ownerMessages: 7 } });
      expect(pendingLinks().map((i) => i.key).sort()).toEqual([`e:${rec.id}`, "wa:385@s.whatsapp.net"].sort());
    } finally {
      stopLinker();
    }
  });
});

describe("a linking pass", () => {
  it("shows the AI each record's values and each contact", () => {
    const rec = createRecord("memo", { title: "Dinner", body: "with Bea" }, { actor: "me" });
    const body = linkPromptBody([
      { key: `e:${rec.id}`, label: "memo", queuedAt: new Date(), attempts: 0 },
      { key: "wa:1@s.whatsapp.net", label: '"Bea" +1', queuedAt: new Date(), attempts: 0 },
      { key: "e:missing", label: "memo", queuedAt: new Date(), attempts: 0 },
    ])!;
    expect(body).toContain(`[[record:e:${rec.id}]] (memo)`);
    expect(body).toContain("with Bea");
    expect(body).toContain('WhatsApp chat 1@s.whatsapp.net: "Bea" +1');
    expect(body).not.toContain("missing");
    expect(linkPromptBody([{ key: "e:missing", label: "", queuedAt: new Date(), attempts: 0 }])).toBeNull();
  });

  it("waits for a burst to settle, runs on the light model, and clears what it linked", async () => {
    const rec = createRecord("memo", { title: "Call Dan" }, { actor: "me" });
    queueLink(`e:${rec.id}`, "memo", new Date(T0));
    const run = vi.fn(async (_body: string, _model: string, _signal: AbortSignal, _runId: string) => outcome());
    expect(await maybeLink(T0 + 1000, run)).toBeNull();
    expect(run).not.toHaveBeenCalled();

    await maybeLink(later, run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![1]).toBe("claude-haiku-5-5");
    expect(pendingLinks()).toEqual([]);
  });

  it("runs at most once per interval", async () => {
    const run = vi.fn(async (_body: string, _model: string, _signal: AbortSignal, _runId: string) => outcome());
    const a = createRecord("memo", { title: "A" }, { actor: "me" });
    queueLink(`e:${a.id}`, "memo", new Date(T0));
    await maybeLink(later, run);
    const b = createRecord("memo", { title: "B" }, { actor: "me" });
    queueLink(`e:${b.id}`, "memo", new Date(T0));
    await maybeLink(later + 60_000, run);
    expect(run).toHaveBeenCalledTimes(1);
    await maybeLink(later + 15 * 60_000, run);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does nothing when the linker or proactive AI is off", async () => {
    const run = vi.fn(async (_body: string, _model: string, _signal: AbortSignal, _runId: string) => outcome());
    queueLink("wa:x", "x", new Date(T0));
    await updateAiSettings({ linkerEnabled: false });
    await maybeLink(later, run);
    await updateAiSettings({ linkerEnabled: true, proactiveEnabled: false });
    await maybeLink(later, run);
    expect(run).not.toHaveBeenCalled();
    expect(pendingLinks()).toHaveLength(1);
  });

  it("keeps items after a refused run, and drops them after repeated failures", () => {
    queueLink("wa:x", "x", new Date(T0));
    const items = () => pendingLinks();
    settle(items(), { ok: false, refused: true });
    expect(items()[0]!.attempts).toBe(0);
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) settle(items(), { ok: false, refused: false });
    expect(items()[0]!.attempts).toBe(MAX_ATTEMPTS - 1);
    settle(items(), { ok: false, refused: false });
    expect(items()).toEqual([]);
  });
});
