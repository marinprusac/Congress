import type { AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Operation } from "@congress/shared-types";
import { migrationsDir, TEST_INTERNAL_TOKEN } from "@congress/test-support";
import type { RunContext, RunOutcome } from "./engine.js";

const runAi = vi.fn<(ctx: RunContext) => Promise<RunOutcome>>();
vi.mock("./engine.js", () => ({ runAi: (ctx: RunContext) => runAi(ctx) }));

import { db, runMigrations } from "../db/client.js";
import { aiBuilderGrants } from "../db/schema.js";
import { app } from "../server.js";
import { startTypeEngine } from "../typeEngine/index.js";
import { getTypeBySlug } from "../typeEngine/store.js";
import { buildMcpServers } from "./mcpConfig.js";
import { activeGrant, decideBuilderRequest, decidePublish, endGrant } from "./builder.js";
import { listOpenAsks } from "./asks.js";
import { getMessage, getThread, getThreadRow, insertThread, listThreadMessages } from "./threads.js";

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

let server: ServerType;
let origin: string;

beforeAll(async () => {
  runMigrations(migrationsDir("congress"));
  startTypeEngine();
  server = await new Promise<ServerType>((resolve) => {
    const s = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, () => resolve(s));
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server.close());

beforeEach(() => {
  runAi.mockReset();
  runAi.mockResolvedValue(outcome());
});

// An MCP client as one run in one thread sees it.
async function mcp(path: "/mcp" | "/mcp/builder", run: { threadId?: number; runId?: string }) {
  const headers: Record<string, string> = { "X-Congress-Internal-Token": TEST_INTERNAL_TOKEN };
  if (run.threadId) headers["X-Congress-Thread-Id"] = String(run.threadId);
  if (run.runId) headers["X-Congress-Run-Id"] = run.runId;
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}${path}`), { requestInit: { headers } }));
  return {
    names: async () => (await client.listTools()).tools.map((t) => t.name).sort(),
    call: async (name: string, args: Record<string, unknown> = {}) => {
      const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      const text = res.content[0]!.text;
      try {
        return JSON.parse(text) as Record<string, unknown>;
      } catch {
        return { error: "tool_error", message: text };
      }
    },
    close: () => client.close(),
  };
}

const BUILDER_TOOLS = ["builder_status", "describe_types", "discard_draft", "list_type_versions", "preview_draft", "request_publish", "set_draft_ops", "start_draft"];

const book: Operation[] = [
  { op: "create_type", slug: "book", label: "Book" },
  { op: "add_field", slug: "title", label: "Title", kind: "text", options: { required: true } },
  { op: "set_title_field", field: "title" },
];

async function flush() {
  await new Promise((r) => setTimeout(r, 20));
}

let threadA: number;
let requestId: number;

describe("requesting builder mode", () => {
  it("opens a request in the run's thread, once, and exposes no builder tools yet", async () => {
    threadA = insertThread({ title: "Books" }).id;
    const congress = await mcp("/mcp", { threadId: threadA, runId: "run-a" });
    const res = await congress.call("request_builder_mode", { title: "Add a Book type", reason: "To track reading.", scope: "book" });
    expect(res).toMatchObject({ ok: true, threadId: threadA });
    requestId = res.messageId as number;
    expect(await congress.call("request_builder_mode", { title: "Again", reason: "x" })).toMatchObject({ error: "invalid" });
    await congress.close();

    expect(listOpenAsks().map((a) => a.kind)).toContain("builder_request");
    const builder = await mcp("/mcp/builder", { threadId: threadA });
    expect(await builder.call("builder_status")).toEqual({ granted: false, until: null, drafts: [] });
    expect(await builder.call("start_draft")).toMatchObject({ error: "not_granted" });
    await builder.close();
    expect(buildMcpServers("congress", { runId: "r", threadId: threadA }).builder).toBeUndefined();
  });

  it("from a run without a thread, opens a new AI thread", async () => {
    const congress = await mcp("/mcp", { runId: "run-proactive" });
    const res = await congress.call("request_builder_mode", { title: "Track books", reason: "You mention books a lot." });
    await congress.close();
    expect(res.threadId).not.toBe(threadA);
    expect(getThreadRow(res.threadId as number)?.origin).toBe("ai");
  });
});

describe("granting", () => {
  it("grants for the chosen time, starts a follow-up run and opens the tools to that thread only", async () => {
    const before = Date.now();
    decideBuilderRequest(requestId, true, { grantMinutes: 15 });
    const grant = activeGrant(threadA)!;
    expect(grant.expiresAt.getTime() - before).toBeGreaterThanOrEqual(15 * 60_000 - 1000);
    expect(grant.expiresAt.getTime() - before).toBeLessThanOrEqual(15 * 60_000 + 1000);
    expect(getMessage(requestId)).toMatchObject({ askState: "approved" });
    expect(getThread(threadA)?.builderUntil).toBe(grant.expiresAt.toISOString());
    await flush();
    expect(runAi).toHaveBeenCalledWith(expect.objectContaining({ threadId: threadA, trigger: "decision", body: expect.stringContaining("granted builder mode") }));

    const servers = buildMcpServers("congress", { runId: "r", threadId: threadA }, { builder: true });
    expect(servers.builder?.headers["X-Congress-Thread-Id"]).toBe(String(threadA));
    expect(servers.types?.headers["X-Congress-Thread-Id"]).toBe(String(threadA));

    const mine = await mcp("/mcp/builder", { threadId: threadA });
    expect(await mine.names()).toEqual(BUILDER_TOOLS);
    await mine.close();
    const other = await mcp("/mcp/builder", { threadId: insertThread({ title: "Other" }).id });
    expect(await other.call("describe_types")).toMatchObject({ error: "not_granted" });
    await other.close();
  });
});

describe("drafting and publishing", () => {
  it("publishes exactly the reviewed draft once the owner approves", async () => {
    const builder = await mcp("/mcp/builder", { threadId: threadA, runId: "run-b" });
    const { draftId } = (await builder.call("start_draft")) as { draftId: string };
    const partial = await builder.call("set_draft_ops", { draftId, ops: book.slice(0, 2) });
    expect(partial.errors).toEqual([expect.stringMatching(/title field/)]);
    expect(await builder.call("request_publish", { draftId, title: "Create Book", summary: "A reading list." })).toMatchObject({
      error: "invalid",
      message: expect.stringMatching(/Fix the draft first/),
    });

    await builder.call("set_draft_ops", { draftId, ops: book.slice(2) });
    expect(await builder.call("preview_draft", { draftId })).toMatchObject({ errors: [], blockers: [], rebuild: false });
    const asked = await builder.call("request_publish", { draftId, title: "Create Book", summary: "A reading list." });
    expect(asked).toMatchObject({ ok: true });
    expect(await builder.call("request_publish", { draftId, title: "Again", summary: "x" })).toMatchObject({ error: "invalid" });
    await builder.close();

    const publishAsk = getMessage(asked.messageId as number)!;
    expect(publishAsk.payload).toMatchObject({ isNew: true, typeLabel: "Book", changes: expect.arrayContaining([{ area: "type", text: "Create type “Book” (Books)" }]) });
    expect(getTypeBySlug("book")).toBeUndefined();

    decidePublish(publishAsk.id, true);
    expect(getTypeBySlug("book")).toMatchObject({ version: 1 });
    expect(getMessage(publishAsk.id)).toMatchObject({ askState: "executed", payload: expect.objectContaining({ publishedVersion: 1 }) });
    await flush();
    expect(runAi).toHaveBeenLastCalledWith(expect.objectContaining({ body: expect.stringContaining("is now version 1") }));
  });

  it("fails instead of publishing a draft that changed after review", async () => {
    const builder = await mcp("/mcp/builder", { threadId: threadA });
    const { draftId } = (await builder.call("start_draft", { slug: "book" })) as { draftId: string };
    await builder.call("set_draft_ops", { draftId, ops: [{ op: "add_field", slug: "author", label: "Author", kind: "text" }] });
    const asked = await builder.call("request_publish", { draftId, title: "Add author", summary: "Who wrote it." });
    await builder.call("set_draft_ops", { draftId, ops: [{ op: "add_field", slug: "isbn", label: "ISBN", kind: "text" }] });
    await builder.close();

    decidePublish(asked.messageId as number, true);
    expect(getMessage(asked.messageId as number)).toMatchObject({ askState: "failed", payload: expect.objectContaining({ error: expect.stringMatching(/changed after/) }) });
    expect(getTypeBySlug("book")?.version).toBe(1);
  });

  it("keeps the draft open when the owner rejects", async () => {
    const builder = await mcp("/mcp/builder", { threadId: threadA });
    const { draftId } = (await builder.call("start_draft", { slug: "book" })) as { draftId: string };
    await builder.call("set_draft_ops", { draftId, ops: [{ op: "add_field", slug: "pages", label: "Pages", kind: "number" }], mode: "replace" });
    const asked = await builder.call("request_publish", { draftId, title: "Add pages", summary: "Length." });
    decidePublish(asked.messageId as number, false, "Not now");
    expect(getMessage(asked.messageId as number)).toMatchObject({ askState: "rejected", payload: expect.objectContaining({ note: "Not now" }) });
    expect(await builder.call("builder_status")).toMatchObject({ granted: true, drafts: [expect.objectContaining({ draftId })] });
    await builder.close();
    expect(getTypeBySlug("book")?.version).toBe(1);
  });
});

describe("ending a grant", () => {
  it("closes the tools at once, even for a run already in progress", async () => {
    const builder = await mcp("/mcp/builder", { threadId: threadA });
    expect(endGrant(threadA)).toBe(true);
    expect(endGrant(threadA)).toBe(false);
    expect(await builder.call("describe_types")).toMatchObject({ error: "not_granted" });
    await builder.close();
    expect(getThread(threadA)?.builderUntil).toBeNull();
    expect(listThreadMessages(threadA).messages.at(-1)).toMatchObject({ kind: "notice", text: "Builder mode ended." });
  });

  it("treats an expired grant as none", () => {
    const thread = insertThread({ title: "Old" }).id;
    db.insert(aiBuilderGrants).values({ threadId: thread, requestMessageId: 0, grantedAt: new Date(0), expiresAt: new Date(Date.now() - 1000) }).run();
    expect(activeGrant(thread)).toBeNull();
  });
});
