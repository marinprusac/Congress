import type { Manifest } from "@congress/shared-types";
import { env } from "./env.js";

const base = `http://${env.HOST}:${env.PORT}`;

export const documentsManifest: Manifest = {
  name: "documents",
  displayName: "Documents",
  version: "0.1.0",
  routes: {
    home: "/documents",
    settings: "/documents/settings",
  },
  apiBase: `${base}/api`,
  mcpUrl: `${base}/mcp`,
  healthUrl: `${base}/health`,
  widgets: [{ id: "recent", width: 3, height: 2, label: "Recent" }],
  events: [
    { type: "documents.created", label: "Document created", description: "A new document was uploaded." },
    { type: "documents.updated", label: "Document updated", description: "A document's title or description changed." },
    { type: "documents.deleted", label: "Document deleted", description: "A document was deleted." },
  ],
};
