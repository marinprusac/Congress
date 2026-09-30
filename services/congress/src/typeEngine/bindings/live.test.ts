import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { migrationsDir } from "@congress/test-support";
import { runMigrations } from "../../db/client.js";
import { onEventPublished, type PublishedEvent } from "../../events.js";
import { runExhibitsMigrations } from "../db/client.js";
import { getTypeBySlug, publish } from "../store.js";
import { createRecord, listRecords, RecordLockedError } from "../records.js";
import { registerTypeTools } from "../mcpTools.js";
import { ConnectorRefusedError, defineConnector, type ConnectorContext, type SourceRecord } from "../../connectors/contract.js";
import { startConnectors, stopConnectors } from "../../connectors/registry.js";
import { liveDetail, materialize, searchSource, startBindings, stopBindings } from "./runtime.js";

// A read-only mail source: a few threads cached, more only through search/fetch.
const cached = new Map<string, string>([["t1", "Hello"]]);
const remote = new Map<string, string>([["t1", "Hello"], ["t9", "Old thread"]]);
let ctx!: ConnectorContext;
const published: PublishedEvent[] = [];
onEventPublished((e) => published.push(e));

const rec = (key: string, subject: string): SourceRecord => ({ kind: "thread", key, values: { subject }, facts: {}, updatedAt: null });
const refuse = () => Promise.reject(new ConnectorRefusedError("read-only"));

const fakeMail = defineConnector({
  name: "fake-mail",
  label: "Fake Mail",
  source: [{ kind: "thread", label: "Thread", fields: [{ slug: "subject", kind: "text", label: "Subject" }], facts: [] }],
  events: [{ type: "fakemail.received", label: "Received" }],
  start: (c) => {
    ctx = c;
  },
  sync: async () => ({ changed: 0, error: null }),
  intervalMs: () => 3_600_000,
  read: {
    get: (_k, key) => (cached.has(key) ? rec(key, cached.get(key)!) : null),
    list: () => [...cached].map(([k, s]) => rec(k, s)),
    detail: async (_c, _k, key, opts) => ({ key, bodies: [`body of ${key}`], opts }),
    search: async (_c, _k, query) => [...remote].filter(([, s]) => s.toLowerCase().includes(query.toLowerCase())).map(([k, s]) => rec(k, s)),
    fetch: async (_c, _k, key) => {
      if (!remote.has(key)) return null;
      cached.set(key, remote.get(key)!);
      return rec(key, remote.get(key)!);
    },
  },
  push: { create: refuse, update: refuse, delete: refuse, act: refuse },
});

const threads = () => listRecords("thread", { limit: 50 });

beforeAll(async () => {
  runMigrations(migrationsDir("congress"));
  runExhibitsMigrations();
  startBindings();
  await startConnectors([fakeMail]);
  publish({
    actor: "test",
    ops: [
      { op: "create_type", slug: "thread", label: "Thread" },
      { op: "add_field", slug: "subject", label: "Subject", kind: "text" },
      { op: "set_title_field", field: "subject" },
      {
        op: "set_binding",
        binding: { connector: "fake-mail", kind: "thread", label: "Fake Mail", fields: [{ source: "subject", target: "subject", mode: "pull" }], delete: "never", actions: [] },
      },
    ],
  });
});

afterAll(async () => {
  stopBindings();
  await stopConnectors();
});

beforeEach(() => {
  published.length = 0;
});

describe("a read-only source", () => {
  it("is the only way records of its type appear", () => {
    expect(threads().map((r) => r.values.subject)).toEqual(["Hello"]);
    expect(() => createRecord("thread", { subject: "Mine" }, { actor: "me" })).toThrow(RecordLockedError);
  });

  it("reads live content for a record", async () => {
    const id = threads()[0]!.id;
    expect(await liveDetail(id, { ai: "1" })).toEqual({ key: "t1", bodies: ["body of t1"], opts: { ai: "1" } });
  });

  it("searches the whole source and makes a hit a record only on demand", async () => {
    const t = getTypeBySlug("thread")!;
    const hits = await searchSource(t, "thread", 10);
    expect(hits).toEqual([{ recordId: null, key: "t9", binding: "bnd_fake-mail_thread", values: { subject: "Old thread" } }]);
    expect(threads()).toHaveLength(1);
    const id = await materialize(t, t.definition.bindings[0]!, "t9");
    expect(threads().find((r) => r.id === id)?.values.subject).toBe("Old thread");
    expect(await materialize(t, t.definition.bindings[0]!, "t9")).toBe(id);
    expect(await materialize(t, t.definition.bindings[0]!, "missing")).toBeNull();
  });

  it("pulls a quiet change without events, a plain one with", () => {
    cached.set("t2", "Backfilled");
    ctx.emitChange("thread", "t2", false, true);
    expect(published.filter((e) => e.type.startsWith("thread."))).toHaveLength(0);
    cached.set("t3", "New");
    ctx.emitChange("thread", "t3");
    expect(published.filter((e) => e.type === "thread.created")).toHaveLength(1);
  });

  it("publishes the connector's own events", () => {
    ctx.publish("fakemail.received", { subject: "Hi" });
    expect(published.find((e) => e.type === "fakemail.received")).toMatchObject({ chamber: "fake-mail", payload: { subject: "Hi" } });
  });

  it("gives the AI read/search-all tools, and no create", () => {
    const names: string[] = [];
    registerTypeTools({ registerTool: (name: string) => names.push(name) } as unknown as McpServer);
    expect(names).toEqual(expect.arrayContaining(["read_thread", "search_all_threads", "get_thread", "list_threads"]));
    expect(names).not.toContain("create_thread");
  });
});
