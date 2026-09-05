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

// Rounds an absolute instant to the nearest 30-minute wall-clock boundary -
// the live snapping used while hovering/dragging over the agenda's blank gap
// space to pick a new event's start (and, on desktop, its end). The
// creation form's own duration/time fields keep finer 15-minute steps
// (DURATION_PRESET_MINUTES / step={15} in EventForm) - only this Agenda
// picking surface was coarsened to 30 minutes.
export function snapToHalfHour(ms: number): number {
  const halfHourMs = 30 * 60 * 1000;
  return Math.round(ms / halfHourMs) * halfHourMs;
}

// Once picking is actively dragging, AgendaGapRow moves the anchor by whole
// 30-minute steps at a fixed screen-space rate (pxPerHalfHour) rather
// than re-deriving an absolute position from deltaPx - so precision never
// depends on how compressed this particular gap's own (sqrt-scaled, see
// durationPx) rendered height happens to be: a day with nothing on it can
// render just a few dozen px tall, where every pixel of *absolute* position
// would otherwise cover tens of real minutes. Clamped to the gap's own
// bounds so a long drag can't pick a time outside what's actually idle here.
export function fineTimeFromDelta(
  anchorMs: number,
  deltaPx: number,
  pxPerHalfHour: number,
  gapStartMs: number,
  gapMinutes: number
): number {
  const steps = Math.round(deltaPx / pxPerHalfHour);
  const ms = anchorMs + steps * 30 * 60_000;
  return Math.min(gapStartMs + gapMinutes * 60_000, Math.max(gapStartMs, ms));
}

// This is a rough visualization, not a precise clock - so a block or gap's
// real duration maps to pixels via sqrt(hours) rather than 1:1 with
// wall-clock time: 1 hour renders as 1 "unit" (PX_PER_HOUR), 4 hours as 2
// units, 15 minutes as half a unit. A 4-hour meeting still visibly takes
// more room than a 1-hour one, just not a literal 4x more - and a 15-minute
// meeting or a slow afternoon both get real, legible space instead of being
// crushed or blown out by strict linear scaling. Applies uniformly to every
// duration the Agenda page turns into a height: gaps, cut-eligible spans
// before they're evaluated against the threshold, and event blocks alike.
const PX_PER_HOUR = 48;
export function durationPx(minutes: number): number {
  return Math.sqrt(Math.max(0, minutes) / 60) * PX_PER_HOUR;
}

// Never give a day inside a merged *multi-day* idle gap less room to
// hover/tap a create-event time into than it would get as a single isolated
// idle day (durationPx already handles that case well - about 235px, ~6
// min/px). Merging several idle days into one gap (buildAgendaTimeline's
// cross-day merging) otherwise compresses the *whole* span via
// sqrt(totalMinutes), and since sqrt(N) grows far slower than N, each
// individual day's own share of the row shrinks toward nothing as more idle
// days pile up - exactly backwards for this row's interactive job
// (AgendaGapRow), where absolute pointer position is what picks a coarse
// time in the first place. This floor only kicks in once a gap actually
// spans more than one calendar day (daysSpanned > 1, i.e. it carries at
// least one dayBreak) - an ordinary same-day gap between two events (a
// 30-minute breather between meetings, say) is not a merged idle day and
// must keep scaling by its own real duration, not balloon to a full day's
// height just because it "spans" the one day it's already on.
const MIN_PX_PER_DAY = durationPx(24 * 60);

export function gapHeightPx(minutes: number, daysSpanned: number): number {
  if (daysSpanned <= 1) return durationPx(minutes);
  return Math.max(durationPx(minutes), daysSpanned * MIN_PX_PER_DAY);
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

// One calendar day's own header, landing at some point inside a gap that
// spans across it - see AgendaGapEntry.dayBreaks.
export interface AgendaGapDayBreak {
  key: string;
  // Minutes from the *start* of the gap this break sits inside - the
  // component turns this into a proportional (linear, not independently
  // sqrt-scaled) position within the gap's own already-compressed height,
  // the same way a block's nowOffsetMinutes places the now-indicator inside
  // an event.
  offsetMinutes: number;
  label: string;
}

// Idle time between two consecutive timed events on the same day, between
// one day's last content and the next day's first, or - if one or more
// entirely empty days sit in between - a single span covering all of it at
// once. A gap always carries exactly one duration, however many calendar
// days it crosses: dayBreaks is where each of those days' own headers gets
// placed, as a point inside this one span, rather than splitting the
// duration itself into one number per day.
export interface AgendaGapEntry {
  kind: "gap";
  key: string;
  // Absolute start of the gap's span - lets the agenda place a "create event
  // here" line/range at a real clock time from a pointer's fractional
  // position inside the gap's own (sqrt-compressed) rendered height, the
  // same linear offsetMinutes/minutes fraction dayBreaks already uses below.
  startMs: number;
  minutes: number;
  // True when this gap is entirely behind "now" (including the one gap that
  // runs right up to it, between the last past event and the current time) -
  // a duration label on idle time that's already over reads as clutter, not
  // information, so the gap still renders its true proportional blank space
  // but without the "45 min" caption a future gap gets.
  past: boolean;
  dayBreaks: AgendaGapDayBreak[];
}

// The current-time indicator, placed at most once wherever "now" actually
// falls in the timeline (mid-event, in a gap, or - if today has no events
// at all, or none scheduled yet - at the point in the flow closest to it).
// Never emitted when "now" isn't inside the window being rendered (see
// AgendaNowContext).
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
  | AgendaNowMarkerEntry;

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
const AGENDA_WEEKDAY_DATE_WITH_YEAR_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "short",
  day: "numeric",
  year: "numeric",
});

// Every rendered day carries its weekday name - the year suffix is the only
// thing that varies, and only to disambiguate a date that's landed in a
// different calendar year than today.
function formatAgendaDayLabel(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date.getFullYear() !== today.getFullYear()
    ? AGENDA_WEEKDAY_DATE_WITH_YEAR_FORMAT.format(date)
    : AGENDA_WEEKDAY_DATE_FORMAT.format(date);
}

// Compact label for a plain gap row, e.g. "45 min", "2h", "2h 15m", or -
// once a gap runs a full day or longer (routine now that a gap can span
// several entirely empty calendar days at once) - "1d", "1d 2h". Always
// exactly one duration, however long the span.
export function formatGapDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  }
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}

interface DayGroup {
  dateKey: string;
  allDay: CalendarEvent[];
  timed: CalendarEvent[];
}

function groupByDay(events: CalendarEvent[]): Map<string, DayGroup> {
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
  return groups;
}

// Every calendar day in [windowStartMs, windowEndMs), in order - the full
// set of days the agenda renders a header for, regardless of which of them
// actually have events (see buildAgendaTimeline).
function enumerateDayKeys(windowStartMs: number, windowEndMs: number): string[] {
  const keys: string[] = [];
  const cursor = new Date(windowStartMs);
  cursor.setHours(0, 0, 0, 0);
  while (cursor.getTime() < windowEndMs) {
    keys.push(localDateOnly(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
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

// Two blocks only need their own side-by-side lane (rather than sharing one,
// full-width) when they overlap enough that showing both at full width would
// genuinely be confusing to tap - a 5-minute tail-overlap between two
// hour-long meetings shouldn't cost either of them half their touch area.
// "Enough" is measured against the *shorter* block's own span: if the
// overlap covers most of it, the two really do read as "the same slot".
const SUBSTANTIAL_OVERLAP_RATIO = 0.75;

function substantiallyOverlaps(a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }): boolean {
  const overlapMs = Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs);
  if (overlapMs <= 0) return false;
  const shorterMs = Math.min(a.endMs - a.startMs, b.endMs - b.startMs);
  return shorterMs > 0 && overlapMs / shorterMs >= SUBSTANTIAL_OVERLAP_RATIO;
}

// Greedy interval-graph coloring, same shape as the textbook exact-overlap
// version: sorted by start (guaranteed by the caller), each event takes the
// lowest-numbered column whose last-placed event doesn't substantially
// overlap it, or opens a new column if none is free yet. Checking only each
// column's *most recent* occupant (not its full history) is what lets two
// blocks that never substantially overlap *each other* time-share a column
// even if both happen to substantially overlap a third, longer block sitting
// in a different column - exactly the common "one long meeting, several
// short ones during it" shape.
function assignColumns(blocks: DayClusterItem["blocks"]): void {
  const columnLast: DayClusterItem["blocks"] = [];
  for (const block of blocks) {
    let placed = false;
    for (let i = 0; i < columnLast.length; i++) {
      if (!substantiallyOverlaps(columnLast[i]!, block)) {
        block.column = i;
        columnLast[i] = block;
        placed = true;
        break;
      }
    }
    if (!placed) {
      block.column = columnLast.length;
      columnLast.push(block);
    }
  }
  for (const block of blocks) block.columnCount = columnLast.length;
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

// Builds the single continuous timeline the Agenda page renders: every
// calendar day in the window gets its own header, whether or not it has any
// events - "no events" is never a reason to skip a day, and idle time is
// never compressed into a collapsed marker. A day with no content of its
// own (no timed events, no all-day events, and it isn't today) contributes
// no flow entries of its own at all - its header instead becomes a
// dayBreak riding inside whichever single gap ends up spanning it, so a run
// of several empty days, or just one ordinary overnight gap, still reads as
// one proportionally-sized span with one duration, with each day's own
// header landing at its own true (midnight) position inside it - never
// split into a separate number per day crossed. Today, specifically, is
// never considered to have "no events" while the current time itself is
// inside the rendered window, since the now-marker always gives it at
// least one item to anchor to.
export function buildAgendaTimeline(events: CalendarEvent[], window: AgendaNowContext): AgendaFlowEntry[] {
  const nowMs = window.nowMs >= window.windowStartMs && window.nowMs < window.windowEndMs ? window.nowMs : null;
  const todayKey = nowMs !== null ? localDateOnly(new Date(nowMs)) : null;

  const byDay = groupByDay(events);
  const days = enumerateDayKeys(window.windowStartMs, window.windowEndMs).map(
    (key): DayGroup => byDay.get(key) ?? { dateKey: key, allDay: [], timed: [] }
  );

  const timeline: AgendaFlowEntry[] = [];

  // A simple, single-day gap between two items in the same day's own
  // sequence - never crosses a day boundary, so it never carries dayBreaks.
  function pushItemGap(keyBase: string, startMs: number, endMs: number) {
    const minutes = Math.max(0, Math.round((endMs - startMs) / 60000));
    if (minutes <= 0) return;
    timeline.push({ kind: "gap", key: `gap-${keyBase}`, startMs, minutes, past: nowMs !== null && endMs <= nowMs, dayBreaks: [] });
  }

  // previousContentEndMs is the end of the last day that actually had
  // content (or null before the very first one); pendingBreaks accumulates
  // the headers of every day crossed since then - empty days that produced
  // no content of their own, plus (once known) the next content-bearing
  // day's own header - until there's an endpoint to flush a single merged
  // gap against.
  let previousContentEndMs: number | null = null;
  let pendingBreaks: AgendaGapDayBreak[] = [];

  function flushPending(endMs: number) {
    if (previousContentEndMs === null) return;
    const startMs = previousContentEndMs;
    const minutes = Math.max(0, Math.round((endMs - startMs) / 60000));
    if (minutes > 0) {
      timeline.push({
        kind: "gap",
        key: `gap-day-${startMs}`,
        startMs,
        minutes,
        past: nowMs !== null && endMs <= nowMs,
        dayBreaks: pendingBreaks,
      });
    } else {
      // No real span to hang the breaks on (e.g. back-to-back events either
      // side of a midnight with no idle time at all) - fall back to a bare
      // header per day so none of them silently disappear.
      for (const brk of pendingBreaks) {
        timeline.push({ kind: "date", key: `date-${brk.key}`, label: brk.label });
      }
    }
    pendingBreaks = [];
  }

  for (const day of days) {
    const items = buildDayItems(day, day.dateKey === todayKey ? nowMs : null);
    const dayMidnightMs = new Date(`${day.dateKey}T00:00:00`).getTime();
    const hasContent = items.length > 0 || day.allDay.length > 0;
    const headerLabel = formatAgendaDayLabel(day.dateKey);

    if (!hasContent) {
      if (previousContentEndMs === null) {
        // Unreachable today (the now-marker always gives it content), kept
        // as a safe fallback for the very first day in the window.
        timeline.push({ kind: "date", key: `date-${day.dateKey}`, label: headerLabel });
      } else {
        pendingBreaks.push({
          key: day.dateKey,
          offsetMinutes: Math.max(0, Math.round((dayMidnightMs - previousContentEndMs) / 60000)),
          label: headerLabel,
        });
      }
      continue;
    }

    const anchorStartMs = items.length > 0 ? itemStart(items[0]!) : dayMidnightMs;
    const anchorEndMs = items.length > 0 ? itemEnd(items[items.length - 1]!) : anchorStartMs;

    if (previousContentEndMs === null) {
      timeline.push({ kind: "date", key: `date-${day.dateKey}`, label: headerLabel });
    } else {
      pendingBreaks.push({
        key: day.dateKey,
        offsetMinutes: Math.max(0, Math.round((dayMidnightMs - previousContentEndMs) / 60000)),
        label: headerLabel,
      });
      flushPending(anchorStartMs);
    }

    if (day.allDay.length > 0) {
      timeline.push({ kind: "allday", key: `allday-${day.dateKey}`, events: day.allDay });
    }

    let previousItemEndMs: number | null = null;
    for (const item of items) {
      const startMs = itemStart(item);
      if (previousItemEndMs !== null) {
        pushItemGap(`item-${item.kind === "now" ? "now" : item.blocks[0]!.event.id}`, previousItemEndMs, startMs);
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

    previousContentEndMs = anchorEndMs;
  }

  // Trailing empty days at the tail of the window (no further content to
  // flush against) still need their headers shown - one final merged gap
  // running to the window's own end.
  flushPending(window.windowEndMs);

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
