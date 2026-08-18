import { like, or, inArray, desc } from "drizzle-orm";
import { createTableBackedExhibits, createPushExhibitSync } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { directives } from "./db/schema.js";
import { env } from "./env.js";
import { getDirective, updateDirective } from "./directives.js";

const exhibits = createTableBackedExhibits({
  idPrefix: "directive-",
  type: "directive",
  urlFor: (id: number) => `/d/${id}`,
  searchRows: (pattern, limit) =>
    db
      .select({ id: directives.id, title: directives.title })
      .from(directives)
      .where(or(like(directives.title, pattern), like(directives.body, pattern)))
      .orderBy(desc(directives.updatedAt))
      .limit(limit)
      .all(),
  resolveRows: (ids) => db.select({ id: directives.id, title: directives.title }).from(directives).where(inArray(directives.id, ids)).all(),
  get: getDirective,
  update: (id, input) => updateDirective(id, { title: input.title, body: input.body }),
  toContent: (id, row) => ({
    id,
    chamber: "deputy",
    type: "directive",
    name: row.title,
    body: row.body,
    isBinary: false,
  }),
});

export const toExhibitId = exhibits.toExhibitId;
export const parseDirectiveId = exhibits.parseId;
export const searchDirectiveExhibits = exhibits.search;
export const resolveDirectiveExhibits = exhibits.resolve;
export const getDirectiveExhibitContent = exhibits.getContent;
export const updateDirectiveExhibitContent = exhibits.updateContent;

export const pushExhibitSync = createPushExhibitSync({
  chamber: "deputy",
  capitolUrl: env.CAPITOL_URL,
  internalToken: env.CONGRESS_INTERNAL_TOKEN,
});
