import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpTextResult as textResult } from "@congress/chamber-kit";
import { listItems, listRecentItems, searchItems, getItem, createItem, updateItem } from "../items.js";

export function registerTools(server: McpServer) {
  server.registerTool(
    "list_items",
    {
      title: "List Items",
      description: "List all items, most recently updated first.",
      inputSchema: {},
    },
    async () => textResult(await listItems())
  );

  server.registerTool(
    "list_recent_items",
    {
      title: "List Recent Items",
      description: "List the most recently updated items.",
      inputSchema: {},
    },
    async () => textResult(await listRecentItems())
  );

  server.registerTool(
    "search_items",
    {
      title: "Search Items",
      description: "Search items by name or body.",
      inputSchema: { query: z.string().min(1) },
    },
    async ({ query }) => textResult(await searchItems(query))
  );

  server.registerTool(
    "get_item",
    {
      title: "Get Item",
      description: "Get a single item by id.",
      inputSchema: { id: z.number().int() },
    },
    async ({ id }) => {
      const item = await getItem(id);
      if (!item) return textResult({ error: "not_found", id });
      return textResult(item);
    }
  );

  server.registerTool(
    "create_item",
    {
      title: "Create Item",
      description: "Create a new item.",
      inputSchema: { name: z.string().min(1), body: z.string().default("") },
    },
    async ({ name, body }) => textResult(await createItem({ name, body }))
  );

  server.registerTool(
    "update_item",
    {
      title: "Update Item",
      description: "Update an existing item's fields by id.",
      inputSchema: {
        id: z.number().int(),
        name: z.string().min(1).optional(),
        body: z.string().optional(),
      },
    },
    async ({ id, name, body }) => {
      const updated = await updateItem(id, { name, body });
      if (!updated) return textResult({ error: "not_found", id });
      return textResult(updated);
    }
  );
}
