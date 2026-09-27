import type { Recurrence } from "@congress/shared-types";

// Wall-clock recurrence maths for tracked items (moved here from Deputy's
// scheduling.ts). "Every day at 9" only means something in a time zone.

interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number;
}

// hourCycle "h23"; some ICU builds still emit "24" for midnight, hence % 24.
function wallClock(date: Date, timeZone: string): CalendarDate & { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute") };
}

// Guess-and-correct: at most an hour off on a DST-change day.
function zonedToUtc(date: CalendarDate, hour: number, minute: number, timeZone: string): number {
  const guess = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  const actual = wallClock(new Date(guess), timeZone);
  return guess + (guess - Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute));
}

// The first instant strictly after `afterMs` reading hour:minute (on
// `dayOfWeek`, 0 = Sunday, when given) in `timeZone`.
function nextWallClock(hour: number, minute: number, timeZone: string, afterMs: number, dayOfWeek?: number): number {
  const anchor = wallClock(new Date(afterMs), timeZone);
  for (let offset = 0; offset <= 8; offset++) {
    const day = new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day + offset));
    if (dayOfWeek !== undefined && day.getUTCDay() !== dayOfWeek) continue;
    const instant = zonedToUtc({ year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate() }, hour, minute, timeZone);
    if (instant > afterMs) return instant;
  }
  throw new Error(`no ${hour}:${minute} occurrence found in ${timeZone}`);
}

export function nextOccurrenceAfter(recurrence: Recurrence, afterMs: number, timeZone: string): number {
  switch (recurrence.type) {
    case "interval":
      return afterMs + recurrence.everyMinutes * 60_000;
    case "daily":
      return nextWallClock(recurrence.hour, recurrence.minute, timeZone, afterMs);
    case "weekly":
      return nextWallClock(recurrence.hour, recurrence.minute, timeZone, afterMs, recurrence.dayOfWeek);
  }
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (n: number) => String(n).padStart(2, "0");

export function describeRecurrence(recurrence: Recurrence): string {
  switch (recurrence.type) {
    case "interval": {
      const m = recurrence.everyMinutes;
      if (m % (60 * 24) === 0) return m === 1440 ? "every day" : `every ${m / 1440} days`;
      if (m % 60 === 0) return m === 60 ? "every hour" : `every ${m / 60} hours`;
      return `every ${m} minutes`;
    }
    case "daily":
      return `daily at ${pad(recurrence.hour)}:${pad(recurrence.minute)}`;
    case "weekly":
      return `every ${DAYS[recurrence.dayOfWeek]} at ${pad(recurrence.hour)}:${pad(recurrence.minute)}`;
  }
}
