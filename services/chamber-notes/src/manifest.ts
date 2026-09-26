import type { Manifest } from "@congress/shared-types";
import { env } from "./env.js";

const base = `http://${env.HOST}:${env.PORT}`;

export const notesManifest: Manifest = {
  name: "notes",
  displayName: "Notes",
  version: "0.1.0",
  routes: {
    home: "/notes",
    settings: "/notes/settings",
  },
  apiBase: `${base}/api`,
  mcpUrl: `${base}/mcp`,
  healthUrl: `${base}/health`,
  // Home feed cards (the remote entry's `views` export) and "+"-creatable
  // Exhibit types - see shared-types' manifestViewSchema/manifestExhibitTypeSchema.
  views: [{ id: "pinned", label: "Pinned notes" }],
  exhibitTypes: [{ type: "note", label: "Note", createPath: "/new" }],
  events: [
    {
      type: "notes.created",
      label: "Note created",
      description: "A new note was created.",
      payloadFields: { noteId: { type: "number" }, title: { type: "string" }, url: { type: "string" } },
    },
    {
      type: "notes.updated",
      label: "Note updated",
      description: "A note's title or content changed.",
      payloadFields: { noteId: { type: "number" }, title: { type: "string" }, url: { type: "string" } },
    },
    {
      type: "notes.deleted",
      label: "Note deleted",
      description: "A note was deleted.",
      payloadFields: { noteId: { type: "number" }, title: { type: "string" } },
    },
  ],
};
