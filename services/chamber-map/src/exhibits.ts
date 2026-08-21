import { like, or, inArray, desc } from "drizzle-orm";
import { createTableBackedExhibits, createPushExhibitSync } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { places } from "./db/schema.js";
import { env } from "./env.js";

const exhibits = createTableBackedExhibits({
  idPrefix: "place-",
  type: "place",
  urlFor: (id: number) => `/p/${id}`,
  searchRows: (pattern, limit) =>
    db
      .select({ id: places.id, title: places.name })
      .from(places)
      .where(or(like(places.name, pattern), like(places.body, pattern)))
      .orderBy(desc(places.updatedAt))
      .limit(limit)
      .all(),
  resolveRows: (ids) => db.select({ id: places.id, title: places.name }).from(places).where(inArray(places.id, ids)).all(),
});

export const toExhibitId = exhibits.toExhibitId;
export const parsePlaceId = exhibits.parseId;
export const searchPlaceExhibits = exhibits.search;
export const resolvePlaceExhibits = exhibits.resolve;

export const pushExhibitSync = createPushExhibitSync({
  chamber: "map",
  capitolUrl: env.CAPITOL_URL,
  internalToken: env.CONGRESS_INTERNAL_TOKEN,
});
