import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpTextResult } from "@congress/chamber-kit";
import { listChambers, getChamber, detachChamber, attachChamber } from "../registry.js";
import {
  searchExhibits,
  resolveExhibits,
  getExhibitChip,
  getConnections,
  addManualConnection,
  removeManualConnection,
} from "../exhibits.js";

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
    "detach_chamber",
    {
      title: "Detach Chamber",
      description:
        "Manually take a Chamber out of rotation - the gateway stops proxying its API/frontend and it disappears from the active list - without deregistering it. Sticks even if the Chamber keeps heartbeating; only attach_chamber clears it.",
      inputSchema: { name: z.string().min(1) },
    },
    async ({ name }) => {
      const chamber = detachChamber(name);
      if (!chamber) return mcpTextResult({ error: "not_found", name });
      return mcpTextResult(chamber);
    }
  );

  server.registerTool(
    "attach_chamber",
    {
      title: "Attach Chamber",
      description: "Clear a manual detach and mark a Chamber active again.",
      inputSchema: { name: z.string().min(1) },
    },
    async ({ name }) => {
      const chamber = attachChamber(name);
      if (!chamber) return mcpTextResult({ error: "not_found", name });
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

  server.registerTool(
    "get_exhibit_chip",
    {
      title: "Get Exhibit Chip",
      description:
        "Build a ready-to-paste [[exhibit:chamber:id|Name]] chip token for an object you just created or fetched via that Chamber's own domain tools (e.g. create_task's or get_task's returned numeric id). Input is the Chamber's own RAW id (e.g. the task's plain numeric id, not \"task-7\") - this tool encodes it into the correct Exhibit id and resolves it for you.",
      inputSchema: { chamber: z.string().min(1), id: z.string().min(1) },
    },
    async ({ chamber, id }) => {
      const result = await getExhibitChip(chamber, id);
      return mcpTextResult(result);
    }
  );

  server.registerTool(
    "get_exhibit_connections",
    {
      title: "Get Exhibit Connections",
      description:
        "List every other Exhibit connected to the given Exhibit (full id, e.g. \"task-7\"), whether the connection came from a [[wikilink]] in body text or was added manually - each resolved to its current name/url, or a deleted/unavailable status.",
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }) => {
      const connections = await getConnections(id);
      return mcpTextResult(connections);
    }
  );

  server.registerTool(
    "create_exhibit_connection",
    {
      title: "Create Exhibit Connection",
      description:
        "Add a manual Connection between two Exhibits (full ids, e.g. \"task-7\" and \"note-12\") - shows up in both Exhibits' Connections without editing either body's text. Pass targetChamber when known (e.g. it came from search_exhibits) so the target gets cached immediately even if it's never been created/edited within Congress.",
      inputSchema: {
        id: z.string().min(1),
        targetExhibitId: z.string().min(1),
        targetChamber: z.string().optional(),
      },
    },
    async ({ id, targetExhibitId, targetChamber }) => {
      const result = await addManualConnection(id, targetExhibitId, targetChamber);
      return mcpTextResult(result);
    }
  );

  server.registerTool(
    "delete_exhibit_connection",
    {
      title: "Delete Exhibit Connection",
      description:
        "Remove a manual Connection between two Exhibits (full ids). Only removes connections added manually - one derived from body text (a [[wikilink]] token) can only be removed by editing that text.",
      inputSchema: { id: z.string().min(1), otherExhibitId: z.string().min(1) },
    },
    async ({ id, otherExhibitId }) => {
      const result = await removeManualConnection(id, otherExhibitId);
      return mcpTextResult(result);
    }
  );
}
