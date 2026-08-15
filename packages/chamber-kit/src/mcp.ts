import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export function mcpTextResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export function createMcpApp(name: string, registerTools: (server: McpServer) => void) {
  const mcpApp = new Hono<{ Bindings: HttpBindings }>();

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
