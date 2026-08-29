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
  widgets: [{ id: "pinned", width: 3, height: 2, label: "Pinned" }],
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
