import { like, or, inArray, desc } from "drizzle-orm";
import { createTableBackedExhibits, createPushExhibitSync } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { items } from "./db/schema.js";
import { env } from "./env.js";

const exhibits = createTableBackedExhibits({
  idPrefix: "item-",
  type: "item",
  urlFor: (id: number) => `/i/${id}`,
  searchRows: (pattern, limit) =>
    db
      .select({ id: items.id, title: items.name })
      .from(items)
      .where(or(like(items.name, pattern), like(items.body, pattern)))
      .orderBy(desc(items.updatedAt))
      .limit(limit)
      .all(),
  resolveRows: (ids) => db.select({ id: items.id, title: items.name }).from(items).where(inArray(items.id, ids)).all(),
});

export const toExhibitId = exhibits.toExhibitId;
export const parseItemId = exhibits.parseId;
export const searchItemExhibits = exhibits.search;
export const resolveItemExhibits = exhibits.resolve;

export const pushExhibitSync = createPushExhibitSync({
  chamber: "__CHAMBER_NAME__",
  capitolUrl: env.CAPITOL_URL,
  internalToken: env.CONGRESS_INTERNAL_TOKEN,
});
