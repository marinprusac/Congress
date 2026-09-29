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

  it("offers no tools for hidden types", async () => {
    expect(await names()).toEqual(["describe_type", "list_types"]);
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
    expect(await names()).toEqual(["create_book", "delete_book", "describe_type", "get_book", "list_books", "list_types", "search_books", "update_book"]);
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

  it("rejects a missing required field", async () => {
    const res = (await callChamberTool(url, TEST_INTERNAL_TOKEN, "create_novel", {})) as { isError?: boolean };
    expect(res.isError).toBe(true);
  });
});
