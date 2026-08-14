import { like, or, inArray, desc } from "drizzle-orm";
import { createTableBackedExhibits, createPushExhibitSync } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { notes } from "./db/schema.js";
import { env } from "./env.js";
import { getNote, updateNote } from "./notes.js";

const exhibits = createTableBackedExhibits({
  idPrefix: "note-",
  type: "note",
  urlFor: (id: number) => `/n/${id}`,
  searchRows: (pattern, limit) =>
    db
      .select()
      .from(notes)
      .where(or(like(notes.title, pattern), like(notes.body, pattern)))
      .orderBy(desc(notes.updatedAt))
      .limit(limit)
      .all(),
  resolveRows: (ids) => db.select().from(notes).where(inArray(notes.id, ids)).all(),
  get: getNote,
  update: (id, input) => updateNote(id, { title: input.title, content: input.body }),
  toContent: (id, row) => ({
    id,
    chamber: "notes",
    type: "note",
    name: row.title,
    body: row.content,
    isBinary: false,
  }),
});

export const toExhibitId = exhibits.toExhibitId;
export const parseNoteId = exhibits.parseId;
export const searchNoteExhibits = exhibits.search;
export const resolveNoteExhibits = exhibits.resolve;
export const getNoteExhibitContent = exhibits.getContent;
export const updateNoteExhibitContent = exhibits.updateContent;

export const pushExhibitSync = createPushExhibitSync({
  chamber: "notes",
  capitolUrl: env.CAPITOL_URL,
  internalToken: env.CONGRESS_INTERNAL_TOKEN,
});
