import type { AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callChamberTool, listChamberTools } from "@congress/chamber-kit";
import { migrationsDir, TEST_INTERNAL_TOKEN } from "@congress/test-support";
import { runMigrations } from "../db/client.js";
import { app } from "../server.js";
import { buildMcpServers } from "../ai/mcpConfig.js";
import { startTypeEngine } from "./index.js";
import { getTypeBySlug, publish } from "./store.js";

let server: ServerType;
let url: string;

const names = async () => (await listChamberTools(url, TEST_INTERNAL_TOKEN)).map((t) => t.name).sort();
async function call(tool: string, args: Record<string, unknown>) {
  const res = (await callChamberTool(url, TEST_INTERNAL_TOKEN, tool, args)) as { content: { text: string }[] };
  return JSON.parse(res.content[0]!.text) as Record<string, unknown>;
}

beforeAll(async () => {
  runMigrations(migrationsDir("congress"));
  startTypeEngine();
  server = await new Promise<ServerType>((resolve) => {
    const s = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, () => resolve(s));
  });
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp/types`;
});

afterAll(() => server.close());

describe("the types MCP server", () => {
  it("is in every run's MCP config once the engine runs", () => {
    expect(buildMcpServers("congress").types?.url).toMatch(/\/mcp\/types$/);
  });

  const toolsFor = (slug: string) => [`create_${slug}`, `delete_${slug}`, `get_${slug}`, `list_${slug}s`, `search_${slug}s`, `update_${slug}`];
  const PREMADE_TOOLS = [
    ...["note", "task", "document", "person", "event"].flatMap(toolsFor),
    "find_or_create_person",
    // Event's Google Calendar binding: destinations and invitation answers.
    "list_event_destinations",
    "accept_event",
    "maybe_event",
    "decline_event",
  ];

  it("offers the premade types' tools, none for hidden types", async () => {
    publish({
      actor: "test",
      ops: [
        { op: "create_type", slug: "secret", label: "Secret" },
        { op: "add_field", slug: "title", label: "Title", kind: "text" },
        { op: "set_title_field", field: "title" },
        { op: "set_type_meta", hidden: true },
      ],
    });
    expect(await names()).toEqual(["describe_type", "list_types", "upload_file", ...PREMADE_TOOLS].sort());
  });

  it("follows the live definitions, per request", async () => {
    publish({
      actor: "test",
      ops: [
        { op: "create_type", slug: "book", label: "Book" },
        { op: "add_field", slug: "title", label: "Title", kind: "text", options: { required: true, searchable: true } },
        { op: "set_title_field", field: "title" },
        { op: "add_field", slug: "read", label: "Read", kind: "boolean" },
      ],
    });
    expect(await names()).toEqual(
      ["create_book", "delete_book", "describe_type", "get_book", "list_books", "list_types", "search_books", "update_book", "upload_file", ...PREMADE_TOOLS].sort()
    );
    publish({ typeId: getTypeBySlug("book")!.id, ops: [{ op: "set_type_meta", slug: "novel", label: "Novel" }], actor: "test" });
    expect(await names()).toContain("create_novel");
  });

  it("creates, updates, finds and deletes records with chip tokens", async () => {
    const created = await call("create_novel", { title: "Dune" });
    expect(created).toMatchObject({ type: "novel", values: { title: "Dune", read: false }, token: `[[exhibit:e:${created.id}|Dune]]` });
    expect(await call("update_novel", { id: created.id, read: true })).toMatchObject({ values: { title: "Dune", read: true } });
    expect(await call("search_novels", { query: "dun" })).toEqual([expect.objectContaining({ id: created.id, name: "Dune" })]);
    expect(await call("get_novel", { id: created.id })).toMatchObject({ id: created.id });
    expect(await call("delete_novel", { id: created.id })).toEqual({ ok: true, id: created.id });
    expect(await call("get_novel", { id: created.id })).toMatchObject({ error: "not_found" });
  });

  it("finds or creates people by email or phone, without duplicates", async () => {
    const ana = await call("find_or_create_person", { email: "Ana@Example.com", values: { name: "Ana" } });
    expect(ana).toMatchObject({ created: true, values: { name: "Ana", emails: "Ana@Example.com" } });
    expect(await call("find_or_create_person", { email: " ana@example.com" })).toMatchObject({ created: false, id: ana.id });
    const bob = await call("find_or_create_person", { phone: "+385 91 123 4567" });
    expect(bob).toMatchObject({ created: true, values: { name: "+385 91 123 4567", phones: "+385 91 123 4567" } });
    expect(await call("create_person", { name: "Ana again", emails: "ana@example.com" })).toMatchObject({ error: "conflict", field: "emails" });
  });

  it("shows which records link to one", async () => {
    publish({
      actor: "test",
      ops: [
        { op: "create_type", slug: "meeting", label: "Meeting" },
        { op: "add_field", slug: "title", label: "Title", kind: "text" },
        { op: "set_title_field", field: "title" },
        { op: "add_field", slug: "people", label: "People", kind: "relation", options: { target: "person", many: true } },
      ],
    });
    const ana = await call("find_or_create_person", { email: "ana@example.com" });
    const meeting = await call("create_meeting", { title: "Standup", people: [ana.id] });
    expect(await call("get_person", { id: ana.id })).toMatchObject({
      linkedFrom: [{ from: "Meetings · People", total: 1, records: [{ id: meeting.id, token: `[[exhibit:e:${meeting.id}|Standup]]` }] }],
    });
    expect(await call("create_meeting", { title: "Bad", people: ["nope"] })).toMatchObject({ error: "invalid" });
  });

  it("rejects a missing required field", async () => {
    const res = (await callChamberTool(url, TEST_INTERNAL_TOKEN, "create_novel", {})) as { isError?: boolean };
    expect(res.isError).toBe(true);
  });
});
