import { like, or, inArray, desc } from "drizzle-orm";
import { createTableBackedExhibits, createPushExhibitSync } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { logRules } from "./db/schema.js";
import { env } from "./env.js";

const exhibits = createTableBackedExhibits({
  idPrefix: "logrule-",
  type: "log-rule",
  urlFor: (id: number) => `/r/${id}`,
  searchRows: (pattern, limit) =>
    db
      .select({ id: logRules.id, title: logRules.title })
      .from(logRules)
      .where(or(like(logRules.title, pattern), like(logRules.body, pattern)))
      .orderBy(desc(logRules.updatedAt))
      .limit(limit)
      .all(),
  resolveRows: (ids) => db.select({ id: logRules.id, title: logRules.title }).from(logRules).where(inArray(logRules.id, ids)).all(),
});

export const toExhibitId = exhibits.toExhibitId;
export const parseLogRuleId = exhibits.parseId;
export const searchLogRuleExhibits = exhibits.search;
export const resolveLogRuleExhibits = exhibits.resolve;

export const pushExhibitSync = createPushExhibitSync({
  chamber: "logs",
  capitolUrl: env.CAPITOL_URL,
  internalToken: env.CONGRESS_INTERNAL_TOKEN,
});
