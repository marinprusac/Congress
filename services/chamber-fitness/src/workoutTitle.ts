import { and, eq, gte, lt } from "drizzle-orm";
import { db } from "./db/client.js";
import { workouts } from "./db/schema.js";

// Hevy workout titles ("Push Day", "Leg Day", ...) repeat across sessions,
// but an Exhibit needs a unique, human-legible name - "<title> · <date>"
// disambiguates by day, and a "(2)", "(3)", ... suffix (ordered by start
// time, ties broken by id) disambiguates same-title workouts logged on the
// same calendar day. Day boundaries are UTC: this Chamber (like
// chamber-deputy's own scheduling.ts) has no owner-timezone setting of its
// own, and the VPS it runs on has no fixed TZ either.
const EXHIBIT_DATE_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export function dayKeyUTC(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dayBoundsUTC(date: Date): { start: Date; end: Date } {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

export function formatWorkoutExhibitTitle(title: string, startTime: Date, rank: number): string {
  const datePart = EXHIBIT_DATE_FORMAT.format(startTime);
  return rank > 1 ? `${title} · ${datePart} (${rank})` : `${title} · ${datePart}`;
}

// 1-indexed position of `id` within `rows` once sorted by start time (ties
// broken by id) - the same order workouts of a given title would have been
// logged in. Falls back to 1 (no suffix) if `id` isn't present, since that
// only happens for a just-deleted row whose own exhibit push is about to be
// marked `deleted` anyway.
export function rankInDayTitleBucket(rows: { id: number; startTime: Date }[], id: number): number {
  const sorted = [...rows].sort((a, b) => a.startTime.getTime() - b.startTime.getTime() || a.id - b.id);
  const index = sorted.findIndex((row) => row.id === id);
  return index === -1 ? 1 : index + 1;
}

// Every workout sharing `title` (exact match) and the same UTC calendar day
// as `startTime` - the full sibling set a rank is computed against.
export function workoutsInDayTitleBucket(title: string, startTime: Date): { id: number; startTime: Date }[] {
  const { start, end } = dayBoundsUTC(startTime);
  return db
    .select({ id: workouts.id, startTime: workouts.startTime })
    .from(workouts)
    .where(and(eq(workouts.title, title), gte(workouts.startTime, start), lt(workouts.startTime, end)))
    .all();
}

export function composeExhibitTitle(id: number, title: string, startTime: Date): string {
  const bucket = workoutsInDayTitleBucket(title, startTime);
  const rank = rankInDayTitleBucket(bucket, id);
  return formatWorkoutExhibitTitle(title, startTime, rank);
}
