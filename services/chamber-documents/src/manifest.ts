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
  // Home feed cards (the remote entry's `views` export) and "+"-creatable
  // Exhibit types - see shared-types' manifestViewSchema/manifestExhibitTypeSchema.
  views: [{ id: "recent", label: "Recent documents" }],
  exhibitTypes: [{ type: "document", label: "Document", createPath: "/new" }],
  events: [
    {
      type: "documents.created",
      label: "Document created",
      description: "A new document was uploaded.",
      payloadFields: { documentId: { type: "number" }, title: { type: "string" }, url: { type: "string" } },
    },
    {
      type: "documents.updated",
      label: "Document updated",
      description: "A document's title or description changed.",
      payloadFields: { documentId: { type: "number" }, title: { type: "string" }, url: { type: "string" } },
    },
    {
      type: "documents.deleted",
      label: "Document deleted",
      description: "A document was deleted.",
      payloadFields: { documentId: { type: "number" }, title: { type: "string" } },
    },
  ],
};
