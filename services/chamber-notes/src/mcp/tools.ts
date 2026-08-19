import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpTextResult as textResult } from "@congress/chamber-kit";
import { listNotes, searchNotes, getNote, createNote, updateNote, deleteNote } from "../notes.js";
import { TitleConflictError } from "../notes.js";

export function registerTools(server: McpServer) {
  server.registerTool(
    "list_notes",
    {
      title: "List Notes",
      description: "List all notes, most recently updated first.",
      inputSchema: {},
    },
    async () => textResult(await listNotes())
  );

  server.registerTool(
    "search_notes",
    {
      title: "Search Notes",
      description: "Search notes by title or body text.",
      inputSchema: { query: z.string().min(1) },
    },
    async ({ query }) => textResult(await searchNotes(query))
  );

  server.registerTool(
    "get_note",
    {
      title: "Get Note",
      description: "Get a single note's full content and frontmatter. Use Capitol's resolve_exhibits/search_exhibits for outgoing references and backlinks.",
      inputSchema: { id: z.number().int() },
    },
    async ({ id }) => {
      const note = await getNote(id);
      if (!note) return textResult({ error: "not_found", id });
      return textResult(note);
    }
  );

  server.registerTool(
    "create_note",
    {
      title: "Create Note",
      description:
        "Create a new note. Content may include a YAML frontmatter fence and [[exhibit:chamber:id|Name]] Exhibit references.",
      inputSchema: { title: z.string().min(1), content: z.string().default("") },
    },
    async ({ title, content }) => {
      try {
        return textResult(await createNote({ title, content }));
      } catch (err) {
        if (err instanceof TitleConflictError) {
          return textResult({ error: "title_conflict", title });
        }
        throw err;
      }
    }
  );

  server.registerTool(
    "update_note",
    {
      title: "Update Note",
      description: "Update an existing note's title and/or content by id.",
      inputSchema: { id: z.number().int(), title: z.string().min(1).optional(), content: z.string().optional() },
    },
    async ({ id, title, content }) => {
      try {
        const updated = await updateNote(id, { title, content });
        if (!updated) return textResult({ error: "not_found", id });
        return textResult(updated);
      } catch (err) {
        if (err instanceof TitleConflictError) {
          return textResult({ error: "title_conflict", title });
        }
        throw err;
      }
    }
  );

  server.registerTool(
    "delete_note",
    {
      title: "Delete Note",
      description: "Delete a note by id.",
      inputSchema: { id: z.number().int() },
    },
    async ({ id }) => {
      const deleted = await deleteNote(id);
      if (!deleted) return textResult({ error: "not_found", id });
      return textResult({ ok: true, id });
    }
  );
}
