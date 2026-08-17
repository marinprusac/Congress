import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export function mcpTextResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

// Gated by the same shared-secret header every Chamber already uses to
// register/heartbeat with Congress (X-Congress-Internal-Token), rather than
// the browser session cookie - matches Congress's own /mcp mount
// (services/congress/src/server.ts), which an MCP client (Claude Code, or
// another Chamber acting as one) already has to authenticate the same way.
// Baked into this shared factory rather than left to each server.ts to
// remember, so every Chamber - including ones scaffolded later - is closed
// by default instead of opt-in.
export function createMcpApp(name: string, registerTools: (server: McpServer) => void, internalToken: string) {
  const mcpApp = new Hono<{ Bindings: HttpBindings }>();

  mcpApp.use("/*", async (c, next) => {
    const token = c.req.header("X-Congress-Internal-Token");
    if (!token || token !== internalToken) return c.json({ error: "unauthorized" }, 401);
    await next();
  });

  mcpApp.all("/*", async (c) => {
    try {
      const server = new McpServer({ name, version: "0.1.0" });
      registerTools(server);

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      await server.connect(transport);

      const body =
        c.req.method === "GET" || c.req.method === "HEAD" ? undefined : await c.req.json().catch(() => undefined);

      await transport.handleRequest(c.env.incoming, c.env.outgoing, body);

      return RESPONSE_ALREADY_SENT;
    } catch (err) {
      console.error("MCP bridge error:", err);
      if (!c.env.outgoing.headersSent) {
        return c.json({ error: "mcp_unavailable" }, 501);
      }
      return RESPONSE_ALREADY_SENT;
    }
  });

  return mcpApp;
}

const CALL_TIMEOUT_MS = 10_000;

// Short-lived: connect, do one operation, close - createMcpApp's own server
// side is already stateless (sessionIdGenerator: undefined), so there's no
// session to keep warm across calls. Used by the Automation Chamber to
// discover a target Chamber's callable tools (editor UI) and invoke one
// (eventPoller.ts) - both low-volume, event-driven call sites, not a hot
// path that would want connection pooling.
async function withMcpClient<T>(mcpUrl: string, internalToken: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: "congress-automation-client", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers: { "X-Congress-Internal-Token": internalToken }, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) },
  });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

// A target Chamber's own callable tools, for the automation editor's
// chamber+tool picker (mirrors TriggerEventPicker's chamber+event pattern on
// the trigger side) - a live tools/list call, not a declared manifest
// catalog like events, since MCP already gives every tool a full input
// schema for free.
export async function listChamberTools(mcpUrl: string, internalToken: string): Promise<Tool[]> {
  const { tools } = await withMcpClient(mcpUrl, internalToken, (client) => client.listTools());
  return tools;
}

export async function callChamberTool(mcpUrl: string, internalToken: string, toolName: string, args: Record<string, unknown>) {
  return withMcpClient(mcpUrl, internalToken, (client) => client.callTool({ name: toolName, arguments: args }));
}
