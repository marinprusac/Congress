import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpTextResult as textResult } from "@congress/chamber-kit";
import { listDocuments, getDocument, createDocument, updateDocument, deleteDocument, FileTooLargeError, MAX_FILE_SIZE_BYTES } from "../documents.js";
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
        "Get a single document's metadata and description. Use Capitol's resolve_exhibits/search_exhibits for outgoing references and connections; the file itself is not returned here.",
      inputSchema: { id: z.number().int() },
    },
    async ({ id }) => {
      const document = await getDocument(id);
      if (!document) return textResult({ error: "not_found", id });
      return textResult(document);
    }
  );

  server.registerTool(
    "upload_document",
    {
      title: "Upload Document",
      description: `Upload a new document. File content is base64-encoded, decoded server-side; the ${Math.floor(MAX_FILE_SIZE_BYTES / (1024 * 1024))}MB limit applies to the decoded file, not the base64 string.`,
      inputSchema: {
        title: z.string().min(1),
        description: z.string().default(""),
        filename: z.string().min(1),
        mimeType: z.string().default("application/octet-stream"),
        contentBase64: z.string().min(1),
      },
    },
    async ({ title, description, filename, mimeType, contentBase64 }) => {
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(Buffer.from(contentBase64, "base64"));
      } catch {
        return textResult({ error: "invalid_base64" });
      }
      try {
        // An MCP tool call already carries the whole payload inline in one
        // JSON request, so there's no genuinely streaming source here the
        // way an HTTP multipart upload has - this just adapts the
        // already-in-memory bytes to createDocument's stream-based input so
        // the one real upload path (the HTTP route) gets to stay streaming.
        const stream = () =>
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          });
        const document = await createDocument({
          title,
          description,
          file: { filename, mimeType, sizeBytes: bytes.byteLength, stream },
        });
        return textResult(document);
      } catch (err) {
        if (err instanceof FileTooLargeError) {
          return textResult({ error: "file_too_large", maxBytes: MAX_FILE_SIZE_BYTES });
        }
        throw err;
      }
    }
  );

  server.registerTool(
    "update_document_metadata",
    {
      title: "Update Document Metadata",
      description: "Update a document's title and/or description by id. Does not replace the uploaded file itself.",
      inputSchema: { id: z.number().int(), title: z.string().min(1).optional(), description: z.string().optional() },
    },
    async ({ id, title, description }) => {
      const updated = await updateDocument(id, { title, description });
      if (!updated) return textResult({ error: "not_found", id });
      return textResult(updated);
    }
  );

  server.registerTool(
    "delete_document",
    {
      title: "Delete Document",
      description: "Delete a document and its stored file by id.",
      inputSchema: { id: z.number().int() },
    },
    async ({ id }) => {
      const deleted = await deleteDocument(id);
      if (!deleted) return textResult({ error: "not_found", id });
      return textResult({ ok: true, id });
    }
  );
}
