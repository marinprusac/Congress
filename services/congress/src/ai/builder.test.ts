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

import { runMigrations } from "../db/client.js";
import { app } from "../server.js";
import { startTypeEngine } from "../typeEngine/index.js";
import { getTypeBySlug } from "../typeEngine/store.js";
import { createRecord, getRecord } from "../typeEngine/records.js";
import { buildMcpServers } from "./mcpConfig.js";
import { decidePublish } from "./builder.js";
import { getMessage, insertThread } from "./threads.js";

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

const BUILDER_TOOLS = ["builder_status", "describe_types", "discard_draft", "list_type_versions", "preview_draft", "publish_draft", "request_publish", "set_draft_ops", "start_draft"];

const book: Operation[] = [
  { op: "create_type", slug: "book", label: "Book" },
  { op: "add_field", slug: "title", label: "Title", kind: "text", options: { required: true } },
  { op: "set_title_field", field: "title" },
];

async function flush() {
  await new Promise((r) => setTimeout(r, 20));
}

let threadA: number;

describe("builder tools without a grant", () => {
  it("are offered to every tool-using run, and builder mode is no longer requested", async () => {
    threadA = insertThread({ title: "Books" }).id;
    expect(buildMcpServers("congress", { runId: "r", threadId: threadA }, { builder: true }).builder?.headers["X-Congress-Thread-Id"]).toBe(String(threadA));
    const congress = await mcp("/mcp", { threadId: threadA });
    expect(await congress.names()).not.toContain("request_builder_mode");
    await congress.close();
    const builder = await mcp("/mcp/builder", { runId: "run-proactive" });
    expect(await builder.names()).toEqual(BUILDER_TOOLS);
    expect(await builder.call("builder_status")).toEqual({ drafts: [] });
    await builder.close();
  });

  it("publish a new type at once, from a run without a thread too", async () => {
    const builder = await mcp("/mcp/builder", { runId: "run-proactive" });
    const { draftId } = (await builder.call("start_draft")) as { draftId: string };
    const partial = await builder.call("set_draft_ops", { draftId, ops: book.slice(0, 2) });
    expect(partial.errors).toEqual([expect.stringMatching(/title field/)]);
    expect(await builder.call("publish_draft", { draftId })).toMatchObject({ error: "invalid" });
    await builder.call("set_draft_ops", { draftId, ops: book.slice(2) });
    expect(await builder.call("publish_draft", { draftId })).toEqual({ ok: true, slug: "book", version: 1 });
    await builder.close();
    expect(getTypeBySlug("book")).toMatchObject({ version: 1 });
  });

  it("change any type, built-in ones included", async () => {
    const builder = await mcp("/mcp/builder", { threadId: threadA });
    const { draftId } = (await builder.call("start_draft", { slug: "note" })) as { draftId: string };
    await builder.call("set_draft_ops", { draftId, ops: [{ op: "add_field", slug: "mood", label: "Mood", kind: "text" }] });
    const before = getTypeBySlug("note")!.version;
    expect(await builder.call("publish_draft", { draftId })).toMatchObject({ ok: true, version: before + 1 });
    await builder.close();
  });
});

describe("changes that would lose data", () => {
  it("need the owner's approval: a kind change that clears values", async () => {
    const rec = createRecord("book", { title: "Dune" }, { actor: "me" });
    const builder = await mcp("/mcp/builder", { threadId: threadA });
    const { draftId } = (await builder.call("start_draft", { slug: "book" })) as { draftId: string };
    await builder.call("set_draft_ops", { draftId, ops: [{ op: "change_field_kind", field: "title", kind: "number" }] });
    const refused = await builder.call("publish_draft", { draftId });
    expect(refused).toMatchObject({ error: "invalid", message: expect.stringMatching(/approval/) });
    await builder.call("discard_draft", { draftId });
    await builder.close();
    expect(getTypeBySlug("book")?.version).toBe(1);
    expect(getRecord(rec.id)?.values.title).toBeTruthy();
  });

  it("deleting a type waits for approval, and publishes exactly what was reviewed", async () => {
    const builder = await mcp("/mcp/builder", { threadId: threadA, runId: "run-b" });
    const { draftId } = (await builder.call("start_draft", { slug: "book" })) as { draftId: string };
    await builder.call("set_draft_ops", { draftId, ops: [{ op: "delete_type" }] });
    expect(await builder.call("publish_draft", { draftId })).toMatchObject({ error: "invalid", message: expect.stringMatching(/deletes a type/) });
    const asked = await builder.call("request_publish", { draftId, title: "Delete Book", summary: "Unused." });
    expect(asked, JSON.stringify(asked)).toMatchObject({ ok: true });
    expect(await builder.call("request_publish", { draftId, title: "Again", summary: "x" })).toMatchObject({ error: "invalid" });
    await builder.close();
    expect(getTypeBySlug("book")).toBeDefined();

    decidePublish(asked.messageId as number, false, "Keep it");
    expect(getMessage(asked.messageId as number)).toMatchObject({ askState: "rejected" });
    expect(getTypeBySlug("book")).toBeDefined();
    await flush();
    expect(runAi).toHaveBeenLastCalledWith(expect.objectContaining({ body: expect.stringContaining("rejected") }));
  });

  it("fails instead of publishing a draft that changed after review", async () => {
    const builder = await mcp("/mcp/builder", { threadId: threadA });
    const { draftId } = (await builder.call("start_draft", { slug: "book" })) as { draftId: string };
    await builder.call("set_draft_ops", { draftId, ops: [{ op: "add_field", slug: "author", label: "Author", kind: "text" }], mode: "replace" });
    const asked = await builder.call("request_publish", { draftId, title: "Add author", summary: "Who wrote it." });
    await builder.call("set_draft_ops", { draftId, ops: [{ op: "add_field", slug: "isbn", label: "ISBN", kind: "text" }] });
    await builder.close();
    const version = getTypeBySlug("book")!.version;
    decidePublish(asked.messageId as number, true);
    expect(getMessage(asked.messageId as number)).toMatchObject({ askState: "failed", payload: expect.objectContaining({ error: expect.stringMatching(/changed after/) }) });
    expect(getTypeBySlug("book")?.version).toBe(version);
  });

  it("deletes a type once the owner approves", async () => {
    const builder = await mcp("/mcp/builder", { threadId: threadA });
    await builder.call("discard_draft", { draftId: ((await builder.call("builder_status")) as { drafts: { draftId: string }[] }).drafts[0]?.draftId ?? "none" });
    const { draftId } = (await builder.call("start_draft", { slug: "book" })) as { draftId: string };
    await builder.call("set_draft_ops", { draftId, ops: [{ op: "delete_type" }], mode: "replace" });
    const asked = await builder.call("request_publish", { draftId, title: "Delete Book", summary: "Unused." });
    await builder.close();
    decidePublish(asked.messageId as number, true);
    expect(getMessage(asked.messageId as number)).toMatchObject({ askState: "executed" });
    expect(getTypeBySlug("book")).toBeUndefined();
  });
});
