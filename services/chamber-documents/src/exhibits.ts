import { like, or, inArray, desc } from "drizzle-orm";
import { createTableBackedExhibits, createPushExhibitSync } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { documents } from "./db/schema.js";
import { env } from "./env.js";
import { getDocument, updateDocument } from "./documents.js";

const exhibits = createTableBackedExhibits({
  idPrefix: "document-",
  type: "document",
  urlFor: (id: number) => `/d/${id}`,
  searchRows: (pattern, limit) =>
    db
      .select()
      .from(documents)
      .where(or(like(documents.title, pattern), like(documents.filename, pattern)))
      .orderBy(desc(documents.updatedAt))
      .limit(limit)
      .all(),
  resolveRows: (ids) => db.select().from(documents).where(inArray(documents.id, ids)).all(),
  get: getDocument,
  update: (id, input) => updateDocument(id, { title: input.title, description: input.body }),
  // Documents are binary, so "body" carries only the description text
  // (itself may contain further [[ references) and the actual bytes are
  // reached via downloadUrl, a second chamber-side route
  // (GET /api/exhibits/:id/content/download) that Capitol's share proxy
  // calls separately.
  toContent: (id, row) => ({
    id,
    chamber: "documents",
    type: "document",
    name: row.title,
    body: row.description,
    isBinary: true,
    downloadUrl: `/api/exhibits/${id}/content/download`,
  }),
});

export const toExhibitId = exhibits.toExhibitId;
export const parseDocumentId = exhibits.parseId;
export const searchDocumentExhibits = exhibits.search;
export const resolveDocumentExhibits = exhibits.resolve;
export const getDocumentExhibitContent = exhibits.getContent;
export const updateDocumentExhibitContent = exhibits.updateContent;

export const pushExhibitSync = createPushExhibitSync({
  chamber: "documents",
  capitolUrl: env.CAPITOL_URL,
  internalToken: env.CONGRESS_INTERNAL_TOKEN,
});
