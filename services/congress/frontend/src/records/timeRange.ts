// Pure: a start/end pair edited as the Calendar editor did it - a start plus
// a duration, or whole days. Times are ISO instants; days are the browser's.
// An all-day end is exclusive (midnight after the last day), like Google's.

const MINUTE = 60_000;
export const DURATIONS = [30, 45, 60, 90, 120, 240];
export const DEFAULT_MINUTES = 60;

const pad = (n: number) => String(n).padStart(2, "0");

export function localDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function localMidnight(date: string, addDays = 0): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d! + addDays).toISOString();
}

export function minutesBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const n = Math.round((Date.parse(end) - Date.parse(start)) / MINUTE);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function plusMinutes(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * MINUTE).toISOString();
}

// A new start keeps the event's length.
export function moveStart(start: string | null, end: string | null, next: string): { start: string; end: string } {
  return { start: next, end: plusMinutes(next, minutesBetween(start, end) ?? DEFAULT_MINUTES) };
}

// The last day an all-day range covers.
export function lastDay(start: string, end: string | null): string {
  const first = localDate(start);
  if (!end) return first;
  const last = localDate(new Date(Date.parse(end) - 1).toISOString());
  return last < first ? first : last;
}

export function allDayRange(first: string, last: string): { start: string; end: string } {
  return { start: localMidnight(first), end: localMidnight(last < first ? first : last, 1) };
}

// Switching keeps the day: whole days <-> 09:00 for an hour.
export function toggleAllDay(start: string, end: string | null, toAllDay: boolean): { start: string; end: string } {
  if (toAllDay) return allDayRange(localDate(start), lastDay(start, end));
  const nine = plusMinutes(localMidnight(localDate(start)), 9 * 60);
  return { start: nine, end: plusMinutes(nine, DEFAULT_MINUTES) };
}

export function describeRange(start: string | null, end: string | null, allDay: boolean): string {
  if (!start) return "—";
  const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  if (allDay) {
    const first = localDate(start);
    const last = lastDay(start, end);
    return first === last ? `${day(start)} · all day` : `${day(start)} – ${day(localMidnight(last))}`;
  }
  const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (!end) return `${day(start)}, ${time(start)}`;
  return localDate(start) === localDate(end) ? `${day(start)}, ${time(start)} – ${time(end)}` : `${day(start)}, ${time(start)} – ${day(end)}, ${time(end)}`;
}
