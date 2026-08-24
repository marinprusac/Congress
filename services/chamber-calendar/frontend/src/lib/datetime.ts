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

function dayKey(event: CalendarEvent): string {
  return event.allDay ? event.start : event.start.slice(0, 10);
}

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

export function formatEventTime(event: CalendarEvent): string {
  if (event.allDay) return "All day";
  return `${TIME_FORMAT.format(new Date(event.start))} – ${TIME_FORMAT.format(new Date(event.end))}`;
}

// Split start/end for the timeline's narrow left-hand time column, where a
// combined "2:00 PM – 3:00 PM" string is too wide to sit next to the line.
export function formatEventStartTime(event: CalendarEvent): string {
  if (event.allDay) return "All day";
  return TIME_FORMAT.format(new Date(event.start));
}

export function formatEventEndTime(event: CalendarEvent): string {
  return TIME_FORMAT.format(new Date(event.end));
}

// The current-time indicator's own label, e.g. "2:47 PM".
export function formatClockTime(ms: number): string {
  return TIME_FORMAT.format(new Date(ms));
}

// A day-change caption - shown with plain typography, never a rule line,
// every time the flow moves onto a new calendar day (including the very
// first day rendered).
export interface AgendaDateEntry {
  kind: "date";
  key: string;
  label: string;
}

// A day's all-day events, called out separately from the proportional
// timed-event flow below since they have no clock time to position by.
export interface AgendaAllDayEntry {
  kind: "allday";
  key: string;
  events: CalendarEvent[];
}

// One event's own slice of a cluster (see AgendaClusterEntry) - offsetMinutes
// and durationMinutes are both relative to the *cluster's* own span, not the
// day, so the component can position/size it as a simple percentage of the
// cluster's box without knowing anything about the rest of the day.
// nowOffsetMinutes is only set on the one block, if any, that the current
// time falls inside - the component uses it to draw the now-indicator as an
// overlay instead of as its own flow entry.
export interface AgendaEventBlock {
  event: CalendarEvent;
  offsetMinutes: number;
  durationMinutes: number;
  column: number;
  columnCount: number;
  nowOffsetMinutes?: number;
}

// One or more events sharing a single contiguous span of overlapping time,
// laid out side by side (block.column of block.columnCount) rather than
// stacked in the flow - stacking two events that are actually concurrent
// would read as "one happens after the other", which is wrong. A day with
// no overlaps at all is still just a run of one-block clusters; the
// component doesn't need a separate single-event code path.
export interface AgendaClusterEntry {
  kind: "cluster";
  key: string;
  durationMinutes: number;
  blocks: AgendaEventBlock[];
}

// Idle time between two consecutive timed events on the same day, or
// between one day's last timed event and the next day's first, that's
// short enough (or, for the same-day case, always) to just render as its
// true proportional whitespace.
export interface AgendaGapEntry {
  kind: "gap";
  key: string;
  minutes: number;
  // True when this gap is entirely behind "now" (including the one gap that
  // runs right up to it, between the last past event and the current time) -
  // a duration label on idle time that's already over reads as clutter, not
  // information, so the gap still renders its true proportional blank space
  // but without the "45 min" caption a future gap gets.
  past: boolean;
}

// Idle time *between two days* at or above CUT_THRESHOLD_MINUTES -
// condensed to a small fixed marker instead of reserving its true (often
// huge) proportional height, so an ordinary night's sleep and a week with
// nothing on the calendar are both "skipped" the same way. Subsumes what
// used to be a separate day-count-based "skipped days" marker: a run of
// entirely empty calendar days is just a very large idle gap between two
// days that do have events. Never applies *within* a day - two events on
// the same day always show their true gap, however long, so a slow
// afternoon isn't mistaken for a missing chunk of the day.
export interface AgendaCutEntry {
  kind: "cut";
  key: string;
  minutes: number;
}

// The current-time indicator, placed at most once wherever "now" actually
// falls in the timeline (mid-event, in a gap, in a cut, or - if today has
// no events at all, or none scheduled yet - at the point in the flow
// closest to it). Never emitted when "now" isn't inside the window being
// rendered (see AgendaNowContext).
export interface AgendaNowMarkerEntry {
  kind: "now";
  key: "now";
  nowMs: number;
}

export type AgendaFlowEntry =
  | AgendaDateEntry
  | AgendaAllDayEntry
  | AgendaClusterEntry
  | AgendaGapEntry
  | AgendaCutEntry
  | AgendaNowMarkerEntry;

// Below this, idle time between two days is shown as real (if compact)
// whitespace so a short late-night-to-early-morning gap still reads at a
// glance; at or above it, the gap is condensed to a fixed-size cut marker
// regardless of how long it actually is - an ordinary night and a two-week
// trip read the same way, just "skipped".
export const CUT_THRESHOLD_MINUTES = 90;

// Bounds the current-time indicator to the window actually being rendered -
// without this, paging the agenda forward/backward with Prev/Next would
// still plant a "now" marker wherever the real current time happened to
// fall relative to that unrelated window (usually meaninglessly at the very
// top or bottom, or not at all in a way that's easy to reason about).
export interface AgendaNowContext {
  nowMs: number;
  windowStartMs: number;
  windowEndMs: number;
}

const AGENDA_WEEKDAY_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "short",
  day: "numeric",
});
const AGENDA_DATE_FORMAT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const AGENDA_DATE_WITH_YEAR_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

// Weekday only shown for the next 7 days out from today (regardless of the
// agenda window's own anchor) - beyond that a weekday name stops being
// useful at a glance and just adds noise.
function formatAgendaDayLabel(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((date.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));

  if (diffDays >= 0 && diffDays <= 7) return AGENDA_WEEKDAY_DATE_FORMAT.format(date);
  if (date.getFullYear() !== today.getFullYear()) return AGENDA_DATE_WITH_YEAR_FORMAT.format(date);
  return AGENDA_DATE_FORMAT.format(date);
}

// Human text for a cut marker's tooltip/sr-only label, e.g. "9 days with no
// events", "3 hours with no events", "90 minutes with no events".
export function formatSkippedDuration(minutes: number): string {
  const unit = (n: number, label: string) => `${n} ${label}${n === 1 ? "" : "s"} with no events`;
  if (minutes >= 24 * 60) return unit(Math.round(minutes / (24 * 60)), "day");
  if (minutes >= 60) return unit(Math.round(minutes / 60), "hour");
  return unit(minutes, "minute");
}

// Compact label for a plain gap row itself (not a tooltip), e.g. "45 min",
// "2h", "2h 15m" - short enough to sit as fine print in the gap's own blank
// space rather than a full sentence like formatSkippedDuration's.
export function formatGapDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

interface DayGroup {
  dateKey: string;
  allDay: CalendarEvent[];
  timed: CalendarEvent[];
}

function groupByDay(events: CalendarEvent[]): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  for (const event of events) {
    const key = dayKey(event);
    let group = groups.get(key);
    if (!group) {
      group = { dateKey: key, allDay: [], timed: [] };
      groups.set(key, group);
    }
    if (event.allDay) group.allDay.push(event);
    else group.timed.push(event);
  }
  return [...groups.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

// One position in a day's own chronological sequence: either a cluster of
// one or more overlapping events, or - only for the one day that's actually
// "today" - the current-time marker. Merging them into a single sorted
// sequence (rather than treating "now" as a separate concern layered on
// top) is what makes "now" naturally inherit the exact same
// never-cut-within-a-day treatment as any other event boundary: the gap on
// either side of it is just the gap on either side of the item before/after
// it in this sequence, computed the same way regardless of which kind those
// neighbors are.
interface DayClusterItem {
  kind: "cluster";
  startMs: number;
  endMs: number;
  blocks: (Omit<AgendaEventBlock, "offsetMinutes" | "durationMinutes"> & { startMs: number; endMs: number })[];
}
interface DayNowItem {
  kind: "now";
  nowMs: number;
}
type DayItem = DayClusterItem | DayNowItem;

function itemStart(item: DayItem): number {
  return item.kind === "now" ? item.nowMs : item.startMs;
}
function itemEnd(item: DayItem): number {
  return item.kind === "now" ? item.nowMs : item.endMs;
}

// Greedy interval-graph coloring: sorted by start (guaranteed by the caller),
// each event takes the lowest-numbered column whose last-placed event has
// already ended by the time this one starts, or opens a new column if none
// is free yet. Standard algorithm for "how many side-by-side lanes does this
// group of overlapping events need, and which lane is each one in".
function assignColumns(blocks: DayClusterItem["blocks"]): void {
  const columnEnds: number[] = [];
  for (const block of blocks) {
    let placed = false;
    for (let i = 0; i < columnEnds.length; i++) {
      if (columnEnds[i]! <= block.startMs) {
        block.column = i;
        columnEnds[i] = block.endMs;
        placed = true;
        break;
      }
    }
    if (!placed) {
      block.column = columnEnds.length;
      columnEnds.push(block.endMs);
    }
  }
  for (const block of blocks) block.columnCount = columnEnds.length;
}

// Groups a day's already-start-sorted timed events into clusters of mutually
// (possibly only transitively) overlapping events - tracking the *running*
// max end time seen so far, not just the previous event's own end, is what
// correctly chains "A overlaps B, B overlaps C" into one cluster even where
// A and C don't directly overlap each other. Because each event only joins
// the current cluster when its start falls before that running max, the
// union of a cluster's events can never contain an internal empty stretch -
// "now", if it falls anywhere in [cluster start, cluster end), is therefore
// guaranteed to land inside one of its actual events, not in a gap between
// them.
function buildClusters(timed: CalendarEvent[], nowMs: number | null): { clusters: DayClusterItem[]; nowConsumed: boolean } {
  const clusters: DayClusterItem[] = [];
  let nowConsumed = false;
  let current: DayClusterItem["blocks"] = [];
  let currentMaxEnd = -Infinity;

  function flush() {
    if (current.length === 0) return;
    assignColumns(current);
    clusters.push({
      kind: "cluster",
      startMs: current[0]!.startMs,
      endMs: Math.max(...current.map((b) => b.endMs)),
      blocks: current,
    });
    current = [];
  }

  for (const event of timed) {
    const startMs = new Date(event.start).getTime();
    const endMs = new Date(event.end).getTime();
    let nowOffsetMinutes: number | undefined;
    if (nowMs !== null && !nowConsumed && nowMs >= startMs && nowMs < endMs) {
      nowOffsetMinutes = Math.max(0, Math.round((nowMs - startMs) / 60000));
      nowConsumed = true;
    }

    if (current.length > 0 && startMs < currentMaxEnd) {
      current.push({ event, startMs, endMs, column: 0, columnCount: 1, nowOffsetMinutes });
      currentMaxEnd = Math.max(currentMaxEnd, endMs);
    } else {
      flush();
      current = [{ event, startMs, endMs, column: 0, columnCount: 1, nowOffsetMinutes }];
      currentMaxEnd = endMs;
    }
  }
  flush();

  return { clusters, nowConsumed };
}

// Builds one day's chronological item sequence. If "now" falls during one
// of this day's own events, it's attached to that event's block as an
// overlay (nowOffsetMinutes) instead of becoming its own item - it's not a
// boundary in that case, it's a point *inside* an existing block.
function buildDayItems(day: DayGroup, nowMs: number | null): DayItem[] {
  const { clusters, nowConsumed } = buildClusters(day.timed, nowMs);
  const items: DayItem[] = [...clusters];
  if (nowMs !== null && !nowConsumed) items.push({ kind: "now", nowMs });

  items.sort((a, b) => itemStart(a) - itemStart(b));
  return items;
}

// Builds the single continuous timeline the Agenda page renders: every day
// that has at least one event (all-day or timed) is shown in full - "no
// events" is the only thing ever skipped, whether that's an ordinary night
// between two days that do have events, or a run of entirely empty
// calendar days. A slow stretch *within* a day never gets skipped (see
// AgendaCutEntry) - and today, specifically, is never considered to have
// "no events" while the current time itself is inside the rendered window,
// since the now-marker always gives it at least one item to anchor to.
export function buildAgendaTimeline(events: CalendarEvent[], now: AgendaNowContext | null = null): AgendaFlowEntry[] {
  const nowMs = now && now.nowMs >= now.windowStartMs && now.nowMs < now.windowEndMs ? now.nowMs : null;
  const todayKey = nowMs !== null ? localDateOnly(new Date(nowMs)) : null;

  const days = groupByDay(events);
  if (todayKey !== null && !days.some((d) => d.dateKey === todayKey)) {
    days.push({ dateKey: todayKey, allDay: [], timed: [] });
    days.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  }

  const timeline: AgendaFlowEntry[] = [];

  // The idle span between startMs and endMs, rendered as a plain
  // proportional gap - or, only when allowCut is set (i.e. this is the span
  // between two different days, never within one), condensed to a cut once
  // it's long enough.
  function pushGap(keyBase: string, startMs: number, endMs: number, allowCut: boolean) {
    const minutes = Math.max(0, Math.round((endMs - startMs) / 60000));
    if (minutes <= 0) return;
    if (allowCut && minutes >= CUT_THRESHOLD_MINUTES) {
      timeline.push({ kind: "cut", key: `cut-${keyBase}`, minutes });
    } else {
      timeline.push({ kind: "gap", key: `gap-${keyBase}`, minutes, past: nowMs !== null && endMs <= nowMs });
    }
  }

  let previousAnchorEndMs: number | null = null;
  for (const day of days) {
    const items = buildDayItems(day, day.dateKey === todayKey ? nowMs : null);
    const anchorStartMs = items.length > 0 ? itemStart(items[0]!) : new Date(`${day.dateKey}T00:00:00`).getTime();
    const anchorEndMs = items.length > 0 ? itemEnd(items[items.length - 1]!) : anchorStartMs;

    if (previousAnchorEndMs !== null) {
      pushGap(`day-${day.dateKey}`, previousAnchorEndMs, anchorStartMs, true);
    }

    timeline.push({ kind: "date", key: `date-${day.dateKey}`, label: formatAgendaDayLabel(day.dateKey) });

    if (day.allDay.length > 0) {
      timeline.push({ kind: "allday", key: `allday-${day.dateKey}`, events: day.allDay });
    }

    let previousItemEndMs: number | null = null;
    for (const item of items) {
      const startMs = itemStart(item);
      if (previousItemEndMs !== null) {
        pushGap(`item-${item.kind === "now" ? "now" : item.blocks[0]!.event.id}`, previousItemEndMs, startMs, false);
      }

      if (item.kind === "now") {
        timeline.push({ kind: "now", key: "now", nowMs: item.nowMs });
      } else {
        const clusterDurationMinutes = Math.max(0, Math.round((item.endMs - item.startMs) / 60000));
        timeline.push({
          kind: "cluster",
          key: item.blocks[0]!.event.id,
          durationMinutes: clusterDurationMinutes,
          blocks: item.blocks.map((block) => ({
            event: block.event,
            offsetMinutes: Math.max(0, Math.round((block.startMs - item.startMs) / 60000)),
            durationMinutes: Math.max(0, Math.round((block.endMs - block.startMs) / 60000)),
            column: block.column,
            columnCount: block.columnCount,
            nowOffsetMinutes: block.nowOffsetMinutes,
          })),
        });
      }
      previousItemEndMs = itemEnd(item);
    }

    previousAnchorEndMs = anchorEndMs;
  }

  return timeline;
}

function localDateOnly(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const WIDGET_SHORT_DATE_FORMAT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

// Same time-only text as formatEventTime, but for the homepage widget where
// events from many different days are listed together - without this,
// "2:00 PM" reads as today even when the event is next week. Near-term
// events get a compact "+N" day offset; anything further out gets a short
// date instead of an ever-growing "+13".
export function formatWidgetEventTime(event: CalendarEvent): string {
  const eventDateStr = event.allDay ? event.start : localDateOnly(new Date(event.start));
  const todayStr = localDateOnly(new Date());
  const timePart = formatEventTime(event);

  if (eventDateStr === todayStr) return timePart;

  const offsetDays = Math.round(
    (new Date(`${eventDateStr}T00:00:00`).getTime() - new Date(`${todayStr}T00:00:00`).getTime()) /
      (24 * 60 * 60 * 1000)
  );

  if (offsetDays > 0 && offsetDays <= 9) return `+${offsetDays} · ${timePart}`;
  return `${WIDGET_SHORT_DATE_FORMAT.format(new Date(`${eventDateStr}T00:00:00`))} · ${timePart}`;
}

const FULL_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});

const FULL_DATE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const AGENDA_RANGE_FORMAT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

// Label for the Agenda page's currently-fetched window, e.g. "Aug 15 – Sep 13"
// - `to` is the exclusive upper bound used for the API call, so the last day
// actually shown is one day before it.
export function formatDateRange(from: Date, to: Date): string {
  const lastDay = new Date(to);
  lastDay.setDate(lastDay.getDate() - 1);
  return `${AGENDA_RANGE_FORMAT.format(from)} – ${AGENDA_RANGE_FORMAT.format(lastDay)}`;
}

function addDaysToDateOnly(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + delta);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Google's all-day "end" date is exclusive (the day after the event's last
// actual day), so it's shifted back by one day before being displayed.
export function formatEventFullRange(event: CalendarEvent): string {
  if (event.allDay) {
    const start = FULL_DATE_FORMAT.format(new Date(`${event.start}T00:00:00`));
    const lastDay = addDaysToDateOnly(event.end, -1);
    if (lastDay <= event.start) return start;
    return `${start} – ${FULL_DATE_FORMAT.format(new Date(`${lastDay}T00:00:00`))}`;
  }
  return `${FULL_DATE_TIME_FORMAT.format(new Date(event.start))} – ${FULL_DATE_TIME_FORMAT.format(new Date(event.end))}`;
}
