import type { CalendarEvent } from "../../../src/types";

export function getBrowserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// Converts an ISO datetime (possibly with a different offset) into the
// "YYYY-MM-DDTHH:mm" shape a <input type="datetime-local"> expects, rendered
// in the browser's local time zone.
export function toDatetimeLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Rounds up to the next 30-minute wall-clock boundary (15:03 -> 15:30,
// 15:30:00.000 exactly -> unchanged) - the default start time offered when
// creating a new event. 30-minute boundaries land the same in local time as
// in UTC, so plain epoch-ms rounding is safe here.
export function nextHalfHourSlot(from: Date): Date {
  const halfHourMs = 30 * 60 * 1000;
  return new Date(Math.ceil(from.getTime() / halfHourMs) * halfHourMs);
}

// Shifts a <input type="datetime-local"> value by a number of minutes,
// staying in the same offset-less local-time shape - used to derive an
// event's end from its start + duration, both directions (EventForm's
// duration field never touches `end` directly).
export function addMinutesToLocalInput(datetimeLocal: string, minutes: number): string {
  const d = new Date(datetimeLocal);
  d.setMinutes(d.getMinutes() + minutes);
  return toDatetimeLocalInput(d.toISOString());
}

// Whole-minute span between two ISO instants - used to derive a loaded
// event's duration for the form's Duration field from its raw start/end.
export function minutesBetween(startIso: string, endIso: string): number {
  return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
}

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

// e.g. "2:47 PM" - an event's start/end, or the "now" line's own label.
export function formatClockTime(ms: number): string {
  return TIME_FORMAT.format(new Date(ms));
}

const DAY_LABEL_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" });
const DAY_LABEL_WITH_YEAR_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "short",
  day: "numeric",
  year: "numeric",
});

// A Timeline day header - the year only when it isn't this year's.
export function formatDayLabel(dateKey: string, nowMs: number): string {
  const date = new Date(`${dateKey}T00:00:00`);
  return date.getFullYear() !== new Date(nowMs).getFullYear()
    ? DAY_LABEL_WITH_YEAR_FORMAT.format(date)
    : DAY_LABEL_FORMAT.format(date);
}

const MONTH_YEAR_FORMAT = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const SHORT_MONTH_FORMAT = new Intl.DateTimeFormat(undefined, { month: "short" });
const SHORT_MONTH_YEAR_FORMAT = new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" });

// The Week view's title - the month(s) the week falls in, like Google
// Calendar: "September 2026", "Sep – Oct 2026", "Dec 2026 – Jan 2027".
export function formatWeekMonths(firstDay: Date, lastDay: Date): string {
  if (firstDay.getFullYear() !== lastDay.getFullYear()) {
    return `${SHORT_MONTH_YEAR_FORMAT.format(firstDay)} – ${SHORT_MONTH_YEAR_FORMAT.format(lastDay)}`;
  }
  if (firstDay.getMonth() !== lastDay.getMonth()) {
    return `${SHORT_MONTH_FORMAT.format(firstDay)} – ${SHORT_MONTH_YEAR_FORMAT.format(lastDay)}`;
  }
  return MONTH_YEAR_FORMAT.format(firstDay);
}
