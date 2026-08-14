import { like, or, inArray, desc } from "drizzle-orm";
import { createTableBackedExhibits, createPushExhibitSync } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { tasks } from "./db/schema.js";
import { env } from "./env.js";
import { getTask, updateTask } from "./tasks.js";

const exhibits = createTableBackedExhibits({
  idPrefix: "task-",
  type: "task",
  urlFor: (id: number) => `/t/${id}`,
  searchRows: (pattern, limit) =>
    db
      .select({ id: tasks.id, title: tasks.name })
      .from(tasks)
      .where(or(like(tasks.name, pattern), like(tasks.description, pattern)))
      .orderBy(desc(tasks.updatedAt))
      .limit(limit)
      .all(),
  resolveRows: (ids) => db.select({ id: tasks.id, title: tasks.name }).from(tasks).where(inArray(tasks.id, ids)).all(),
  get: getTask,
  update: (id, input) => updateTask(id, { name: input.title, description: input.body }),
  toContent: (id, row) => ({
    id,
    chamber: "tasks",
    type: "task",
    name: row.name,
    body: row.description,
    isBinary: false,
  }),
});

export const toExhibitId = exhibits.toExhibitId;
export const parseTaskId = exhibits.parseId;
export const searchTaskExhibits = exhibits.search;
export const resolveTaskExhibits = exhibits.resolve;
export const getTaskExhibitContent = exhibits.getContent;
export const updateTaskExhibitContent = exhibits.updateContent;

export const pushExhibitSync = createPushExhibitSync({
  chamber: "tasks",
  capitolUrl: env.CAPITOL_URL,
  internalToken: env.CONGRESS_INTERNAL_TOKEN,
});
