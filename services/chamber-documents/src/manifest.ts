import type { Manifest } from "@congress/shared-types";

export const documentsManifest: Manifest = {
  name: "documents",
  displayName: "Documents",
  version: "0.1.0",
  routes: {
    home: "/documents",
    settings: "/documents/settings",
  },
  // Views are only genuine screens (see shared-types' manifestViewSchema) -
  // this Chamber's exhibits reach the home feed and Search on their own.
  // exhibitTypes is what the home screen's "+" can create here.
  views: [],
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
