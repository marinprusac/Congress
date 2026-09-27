import { and, asc, desc, eq, inArray, isNotNull, lte } from "drizzle-orm";
import {
  recurrenceSchema,
  watchEventSchema,
  type Fact,
  type Recurrence,
  type TrackedItem,
  type TrackingStatus,
  type UpdateTrackedItemRequest,
  type WatchEvent,
} from "@congress/shared-types";
import { z } from "zod";
import { db } from "../db/client.js";
import { aiFacts, aiTracking } from "../db/schema.js";
import { describeRecurrence, nextOccurrenceAfter } from "./recurrence.js";

type TrackingRow = typeof aiTracking.$inferSelect;

// Item ids with a check queued or running (set by tracking.ts).
export const checkingItems = new Set<number>();

let onChange: () => void = () => {};
// tracking.ts re-arms its timer whenever an item changes.
export function onTrackingChange(listener: () => void): void {
  onChange = listener;
}

function parse<S extends z.ZodTypeAny>(schema: S, value: string | null, fallback: z.output<S>): z.output<S> {
  if (!value) return fallback;
  try {
    const r = schema.safeParse(JSON.parse(value));
    return r.success ? r.data : fallback;
  } catch {
    return fallback;
  }
}

function toItem(row: TrackingRow): TrackedItem {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    status: row.status,
    watchEvents: parse(z.array(watchEventSchema), row.watchEventsJson, []),
    nextCheckAt: row.nextCheckAt?.toISOString() ?? null,
    recurrence: parse(recurrenceSchema.nullable(), row.recurrenceJson, null),
    refs: parse(z.array(z.string()), row.refsJson, []),
    threadId: row.threadId,
    source: row.source,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    checking: checkingItems.has(row.id),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serverTimeZone(timeZone: string | null): string {
  return timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function listTracking(statuses?: TrackingStatus[]): TrackedItem[] {
  return db
    .select()
    .from(aiTracking)
    .where(statuses?.length ? inArray(aiTracking.status, statuses) : undefined)
    .orderBy(asc(aiTracking.status), desc(aiTracking.updatedAt))
    .all()
    .map(toItem);
}

export function getTracking(id: number): TrackedItem | null {
  const row = db.select().from(aiTracking).where(eq(aiTracking.id, id)).get();
  return row ? toItem(row) : null;
}

export function dueTracking(now: Date): TrackedItem[] {
  return db
    .select()
    .from(aiTracking)
    .where(and(eq(aiTracking.status, "active"), isNotNull(aiTracking.nextCheckAt), lte(aiTracking.nextCheckAt, now)))
    .all()
    .map(toItem);
}

export function nextTrackingCheckMs(): number | null {
  const row = db
    .select({ at: aiTracking.nextCheckAt })
    .from(aiTracking)
    .where(and(eq(aiTracking.status, "active"), isNotNull(aiTracking.nextCheckAt)))
    .orderBy(asc(aiTracking.nextCheckAt))
    .limit(1)
    .get();
  return row?.at?.getTime() ?? null;
}

export interface NewTrackedItem {
  title: string;
  body?: string;
  watchEvents?: WatchEvent[];
  nextCheckAt?: Date | null;
  recurrence?: Recurrence | null;
  refs?: string[];
  threadId?: number | null;
  source?: TrackedItem["source"];
  status?: TrackingStatus;
}

export function createTracking(input: NewTrackedItem, timeZone: string | null, now = new Date()): TrackedItem {
  const recurrence = input.recurrence ?? null;
  // A recurring item with no first check starts at its next slot.
  const nextCheckAt = input.nextCheckAt ?? (recurrence ? new Date(nextOccurrenceAfter(recurrence, now.getTime(), serverTimeZone(timeZone))) : null);
  const row = db
    .insert(aiTracking)
    .values({
      title: input.title,
      body: input.body ?? "",
      status: input.status ?? "active",
      watchEventsJson: JSON.stringify(input.watchEvents ?? []),
      nextCheckAt,
      recurrenceJson: recurrence ? JSON.stringify(recurrence) : null,
      refsJson: JSON.stringify(input.refs ?? []),
      threadId: input.threadId ?? null,
      source: input.source ?? "ai",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  onChange();
  return toItem(row);
}

export function updateTracking(id: number, patch: UpdateTrackedItemRequest & { threadId?: number | null; lastCheckedAt?: Date }, now = new Date()): TrackedItem | null {
  const set: Partial<TrackingRow> = { updatedAt: now };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.body !== undefined) set.body = patch.body;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.watchEvents !== undefined) set.watchEventsJson = JSON.stringify(patch.watchEvents);
  if (patch.nextCheckAt !== undefined) set.nextCheckAt = patch.nextCheckAt ? new Date(patch.nextCheckAt) : null;
  if (patch.recurrence !== undefined) set.recurrenceJson = patch.recurrence ? JSON.stringify(patch.recurrence) : null;
  if (patch.refs !== undefined) set.refsJson = JSON.stringify(patch.refs);
  if (patch.threadId !== undefined) set.threadId = patch.threadId;
  if (patch.lastCheckedAt !== undefined) set.lastCheckedAt = patch.lastCheckedAt;
  const row = db.update(aiTracking).set(set).where(eq(aiTracking.id, id)).returning().get();
  onChange();
  return row ? toItem(row) : null;
}

// Internal bookkeeping that shouldn't count as an edit.
export function setTrackingSchedule(id: number, fields: { nextCheckAt?: Date | null; lastCheckedAt?: Date; threadId?: number }): void {
  db.update(aiTracking).set(fields).where(eq(aiTracking.id, id)).run();
  onChange();
}

export function deleteTracking(id: number): boolean {
  const deleted = db.delete(aiTracking).where(eq(aiTracking.id, id)).run().changes > 0;
  onChange();
  return deleted;
}

// ---- Facts ----

function toFact(row: typeof aiFacts.$inferSelect): Fact {
  return { id: row.id, text: row.text, source: row.source, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export function listFacts(): Fact[] {
  return db.select().from(aiFacts).orderBy(asc(aiFacts.id)).all().map(toFact);
}

export function addFact(text: string, source: Fact["source"]): Fact {
  const now = new Date();
  return toFact(db.insert(aiFacts).values({ text, source, createdAt: now, updatedAt: now }).returning().get());
}

export function updateFact(id: number, text: string): Fact | null {
  const row = db.update(aiFacts).set({ text, updatedAt: new Date() }).where(eq(aiFacts.id, id)).returning().get();
  return row ? toFact(row) : null;
}

export function deleteFact(id: number): boolean {
  return db.delete(aiFacts).where(eq(aiFacts.id, id)).run().changes > 0;
}

// ---- Prompt ----

const MAX_FACTS_IN_PROMPT = 80;
const MAX_ITEMS_IN_PROMPT = 40;

function localTime(iso: string | null, zone: string): string {
  if (!iso) return "none";
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function trackedItemLine(item: TrackedItem, zone: string): string {
  const parts = [`#${item.id} "${item.title}"`, `next check: ${localTime(item.nextCheckAt, zone)}`];
  if (item.recurrence) parts.push(describeRecurrence(item.recurrence));
  if (item.watchEvents.length) parts.push(`watches: ${item.watchEvents.map((w) => `${w.type}${w.immediate ? " (immediate)" : ""}`).join(", ")}`);
  if (item.status !== "active") parts.push(item.status);
  const body = item.body.replace(/\s+/g, " ").trim();
  return `- ${parts.join(" · ")}${body ? `\n  ${body.slice(0, 240)}${body.length > 240 ? "…" : ""}` : ""}`;
}

// What the AI remembers, for every run's prompt.
export function memoryPromptSection(timeZone: string | null): string {
  const zone = serverTimeZone(timeZone);
  const facts = listFacts().slice(-MAX_FACTS_IN_PROMPT);
  const items = listTracking(["active", "paused"]).slice(0, MAX_ITEMS_IN_PROMPT);
  const parts = [
    "## Memory",
    "Facts you've learned about the owner (remember_fact / update_fact / forget_fact keep this current):",
    facts.length ? facts.map((f) => `- [${f.id}] ${f.text}`).join("\n") : "- (none yet)",
    "",
    "Things you're tracking for the owner (track / update_tracking / list_tracking). When the owner asks you to keep an eye on something, remind them later, or act when something happens, create a tracked item rather than relying on memory:",
    items.length ? items.map((i) => trackedItemLine(i, zone)).join("\n") : "- (none yet)",
  ];
  return parts.join("\n");
}
