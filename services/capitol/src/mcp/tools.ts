import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listChambers, getChamber } from "../registry.js";

export function registerTools(server: McpServer) {
  server.registerTool(
    "list_chambers",
    {
      title: "List Chambers",
      description: "List all Chambers registered with Capitol, including their status.",
      inputSchema: {},
    },
    async () => {
      const chambers = listChambers();
      return {
        content: [{ type: "text", text: JSON.stringify(chambers, null, 2) }],
      };
    }
  );

  server.registerTool(
    "get_chamber_status",
    {
      title: "Get Chamber Status",
      description: "Get the registry entry and status for a single Chamber by name.",
      inputSchema: { name: z.string().min(1) },
    },
    async ({ name }) => {
      const chamber = getChamber(name);
      if (!chamber) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "not_found", name }) }],
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(chamber, null, 2) }],
      };
    }
  );
}
