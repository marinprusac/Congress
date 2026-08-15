import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpTextResult as textResult } from "@congress/chamber-kit";
import { listDocuments, getDocument } from "../documents.js";
import { searchDocumentExhibits } from "../exhibits.js";

export function registerTools(server: McpServer) {
  server.registerTool(
    "list_documents",
    {
      title: "List Documents",
      description: "List all documents, most recently updated first.",
      inputSchema: {},
    },
    async () => textResult(await listDocuments())
  );

  server.registerTool(
    "search_documents",
    {
      title: "Search Documents",
      description: "Search documents by title or filename.",
      inputSchema: { query: z.string().min(1) },
    },
    async ({ query }) => textResult(await searchDocumentExhibits(query))
  );

  server.registerTool(
    "get_document",
    {
      title: "Get Document",
      description:
        "Get a single document's metadata and description. Use Capitol's resolve_exhibits/search_exhibits for outgoing references and backlinks; the file itself is not returned here.",
      inputSchema: { id: z.number().int() },
    },
    async ({ id }) => {
      const document = await getDocument(id);
      if (!document) return textResult({ error: "not_found", id });
      return textResult(document);
    }
  );
}
