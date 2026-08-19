import { like, or, inArray, desc } from "drizzle-orm";
import { createTableBackedExhibits, createPushExhibitSync } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { documents } from "./db/schema.js";
import { env } from "./env.js";

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
});

export const toExhibitId = exhibits.toExhibitId;
export const parseDocumentId = exhibits.parseId;
export const searchDocumentExhibits = exhibits.search;
export const resolveDocumentExhibits = exhibits.resolve;

export const pushExhibitSync = createPushExhibitSync({
  chamber: "documents",
  capitolUrl: env.CAPITOL_URL,
  internalToken: env.CONGRESS_INTERNAL_TOKEN,
});
