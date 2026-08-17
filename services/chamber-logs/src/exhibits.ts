import { like, or, inArray, desc } from "drizzle-orm";
import { createTableBackedExhibits, createPushExhibitSync } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { logRules } from "./db/schema.js";
import { env } from "./env.js";
import { getLogRule, updateLogRule } from "./logRules.js";

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
  get: getLogRule,
  update: (id, input) => updateLogRule(id, { title: input.title, body: input.body }),
  toContent: (id, row) => ({
    id,
    chamber: "logs",
    type: "log-rule",
    name: row.title,
    body: row.body,
    isBinary: false,
  }),
});

export const toExhibitId = exhibits.toExhibitId;
export const parseLogRuleId = exhibits.parseId;
export const searchLogRuleExhibits = exhibits.search;
export const resolveLogRuleExhibits = exhibits.resolve;
export const getLogRuleExhibitContent = exhibits.getContent;
export const updateLogRuleExhibitContent = exhibits.updateContent;

export const pushExhibitSync = createPushExhibitSync({
  chamber: "logs",
  capitolUrl: env.CAPITOL_URL,
  internalToken: env.CONGRESS_INTERNAL_TOKEN,
});
