import { like, or, inArray, desc } from "drizzle-orm";
import { createTableBackedExhibits, createPushExhibitSync } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { automations } from "./db/schema.js";
import { env } from "./env.js";
import { getAutomation, updateAutomation } from "./automations.js";

const exhibits = createTableBackedExhibits({
  idPrefix: "automation-",
  type: "automation",
  urlFor: (id: number) => `/a/${id}`,
  searchRows: (pattern, limit) =>
    db
      .select({ id: automations.id, title: automations.title })
      .from(automations)
      .where(or(like(automations.title, pattern), like(automations.body, pattern)))
      .orderBy(desc(automations.updatedAt))
      .limit(limit)
      .all(),
  resolveRows: (ids) =>
    db.select({ id: automations.id, title: automations.title }).from(automations).where(inArray(automations.id, ids)).all(),
  get: getAutomation,
  update: (id, input) => updateAutomation(id, { title: input.title, body: input.body }),
  toContent: (id, row) => ({
    id,
    chamber: "automation",
    type: "automation",
    name: row.title,
    body: row.body,
    isBinary: false,
  }),
});

export const toExhibitId = exhibits.toExhibitId;
export const parseAutomationId = exhibits.parseId;
export const searchAutomationExhibits = exhibits.search;
export const resolveAutomationExhibits = exhibits.resolve;
export const getAutomationExhibitContent = exhibits.getContent;
export const updateAutomationExhibitContent = exhibits.updateContent;

export const pushExhibitSync = createPushExhibitSync({
  chamber: "automation",
  capitolUrl: env.CAPITOL_URL,
  internalToken: env.CONGRESS_INTERNAL_TOKEN,
});
