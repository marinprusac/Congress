import type { CalendarEvent } from "../../../src/types";

// Pure layout for Calendar's two views - the Timeline (a plain day-by-day
// list) and the Week grid. Neither does any drag/resize/pick math: an event
// is either a row in a list or a box at its real clock position.

const pad = (n: number) => String(n).padStart(2, "0");

// "YYYY-MM-DD" in the browser's local zone - the same shape an all-day
// event's own start/end carry.
export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Local midnight of the day `days` after `date` - setDate rather than adding
// 24h so a DST change never shifts the result off midnight.
export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}

// Weeks start on Monday.
export function startOfWeek(date: Date): Date {
  const d = addDays(date, 0);
  return addDays(d, -((d.getDay() + 6) % 7));
}

// An invitation not yet accepted, or an event the owner has marked as not
// attending - drawn lighter/dashed: a possible slot, not a commitment.
export function isTentative(event: CalendarEvent): boolean {
  const { isInvitation, responseStatus, notAttending } = event.attendance;
  return notAttending || (isInvitation && (responseStatus === "needsAction" || responseStatus === "tentative"));
}

// Whether an all-day event (end date exclusive) covers the given day.
function allDayCovers(event: CalendarEvent, dateKey: string): boolean {
  const start = event.start.slice(0, 10);
  const end = event.end.slice(0, 10);
  return start <= dateKey && (dateKey < end || (end <= start && dateKey === start));
}

function startMs(event: CalendarEvent): number {
  return new Date(event.start).getTime();
}

function endMs(event: CalendarEvent): number {
  return new Date(event.end).getTime();
}

// ---------------------------------------------------------------- Timeline

export type TimelineEntry =
  | { kind: "event"; event: CalendarEvent; past: boolean; ongoing: boolean }
  | { kind: "now"; nowMs: number };

export interface TimelineDay {
  dateKey: string;
  isToday: boolean;
  allDay: CalendarEvent[];
  entries: TimelineEntry[];
}

// Days from `from` (local midnight) for `days` days. A timed event is listed
// once, on the day it starts (or the first day, if it started earlier and is
// still running); an all-day event on every day it covers. Days with nothing
// on them are left out, except today, which always shows - with a "now" line
// placed before the first event that hasn't started yet.
export function buildTimeline(events: CalendarEvent[], opts: { from: Date; days: number; nowMs: number }): TimelineDay[] {
  const firstDay = addDays(opts.from, 0);
  const firstKey = localDateKey(firstDay);
  const todayKey = localDateKey(new Date(opts.nowMs));
  const timed = events.filter((e) => !e.allDay).sort((a, b) => startMs(a) - startMs(b) || endMs(a) - endMs(b));
  const allDay = events.filter((e) => e.allDay);

  const result: TimelineDay[] = [];
  for (let i = 0; i < opts.days; i++) {
    const dateKey = localDateKey(addDays(firstDay, i));
    const isToday = dateKey === todayKey;
    const dayEvents = timed.filter((e) => {
      const key = localDateKey(new Date(e.start));
      return (key < firstKey ? firstKey : key) === dateKey;
    });

    const entries: TimelineEntry[] = [];
    let nowPlaced = !isToday;
    for (const event of dayEvents) {
      if (!nowPlaced && startMs(event) > opts.nowMs) {
        entries.push({ kind: "now", nowMs: opts.nowMs });
        nowPlaced = true;
      }
      entries.push({
        kind: "event",
        event,
        past: endMs(event) <= opts.nowMs,
        ongoing: startMs(event) <= opts.nowMs && opts.nowMs < endMs(event),
      });
    }
    if (!nowPlaced) entries.push({ kind: "now", nowMs: opts.nowMs });

    const dayAllDay = allDay.filter((e) => allDayCovers(e, dateKey));
    if (isToday || dayEvents.length > 0 || dayAllDay.length > 0) {
      result.push({ dateKey, isToday, allDay: dayAllDay, entries });
    }
  }
  return result;
}

// -------------------------------------------------------------------- Week

// A box shorter than this would be unreadable, so overlap is judged on the
// box as drawn: two back-to-back 5-minute events still get side by side.
export const MIN_BLOCK_MINUTES = 20;

export interface WeekBlock {
  event: CalendarEvent;
  // Minutes from this day's midnight, clipped to the day.
  startMin: number;
  endMin: number;
  column: number;
  columns: number;
}

export interface WeekDay {
  dateKey: string;
  date: Date;
  allDay: CalendarEvent[];
  blocks: WeekBlock[];
}

const DAY_MINUTES = 24 * 60;

// Standard calendar-grid layout: events that overlap (transitively) form a
// group; within a group each event takes the leftmost column free at its
// start, and every event in the group shares the group's column count.
function assignColumns(blocks: WeekBlock[]): void {
  let group: WeekBlock[] = [];
  let columnEnds: number[] = [];
  let groupEnd = -Infinity;

  const flush = () => {
    for (const b of group) b.columns = columnEnds.length;
    group = [];
    columnEnds = [];
  };

  for (const block of blocks) {
    const drawnEnd = Math.max(block.endMin, block.startMin + MIN_BLOCK_MINUTES);
    if (block.startMin >= groupEnd) flush();
    let column = columnEnds.findIndex((end) => end <= block.startMin);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(drawnEnd);
    } else {
      columnEnds[column] = drawnEnd;
    }
    block.column = column;
    group.push(block);
    groupEnd = group.length === 1 ? drawnEnd : Math.max(groupEnd, drawnEnd);
  }
  flush();
}

// The seven days starting at `weekStart`. A timed event spanning midnight is
// clipped into each day it touches.
export function buildWeek(events: CalendarEvent[], weekStart: Date): WeekDay[] {
  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    const dayStart = date.getTime();
    const dayEnd = addDays(date, 1).getTime();
    const dateKey = localDateKey(date);

    const blocks: WeekBlock[] = events
      .filter((e) => !e.allDay && startMs(e) < dayEnd && (endMs(e) > dayStart || startMs(e) === dayStart))
      .map((event) => ({
        event,
        startMin: Math.max(0, Math.round((startMs(event) - dayStart) / 60000)),
        endMin: Math.min(DAY_MINUTES, Math.round((endMs(event) - dayStart) / 60000)),
        column: 0,
        columns: 1,
      }))
      .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
    assignColumns(blocks);

    days.push({ dateKey, date, allDay: events.filter((e) => e.allDay && allDayCovers(e, dateKey)), blocks });
  }
  return days;
}
