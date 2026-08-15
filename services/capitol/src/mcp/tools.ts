import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpTextResult } from "@congress/chamber-kit";
import { listChambers, getChamber } from "../registry.js";
import { searchExhibits, resolveExhibits } from "../exhibits.js";

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
      return mcpTextResult(chambers);
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
        return mcpTextResult({ error: "not_found", name });
      }
      return mcpTextResult(chamber);
    }
  );

  server.registerTool(
    "search_exhibits",
    {
      title: "Search Exhibits",
      description:
        "Search for Exhibits (notes, calendar events, and other referenceable objects) across every active Chamber.",
      inputSchema: { query: z.string().min(1) },
    },
    async ({ query }) => {
      const results = await searchExhibits(query);
      return mcpTextResult(results);
    }
  );

  server.registerTool(
    "resolve_exhibits",
    {
      title: "Resolve Exhibits",
      description:
        "Batch-resolve a list of Exhibit references (id + owning chamber) into their current name/url, or a deleted/unavailable status.",
      inputSchema: {
        refs: z.array(z.object({ id: z.string().min(1), chamber: z.string().min(1) })),
      },
    },
    async ({ refs }) => {
      const results = await resolveExhibits(refs);
      return mcpTextResult(results);
    }
  );
}
