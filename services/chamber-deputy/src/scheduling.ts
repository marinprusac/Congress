// Wall-clock scheduling math for directives.ts's "daily"/"weekly" schedule
// types - "interval" (plain every-N-ms) needed none of this, but "every day
// at 9am"/"every Wednesday at 9am" only mean something once anchored to a
// specific IANA time zone (the VPS this runs on has no fixed TZ of its own,
// and isn't necessarily the owner's), so each directive carries its own
// `scheduleTimeZone` (captured from the browser at creation time) rather
// than assuming the server's.

export type DirectiveScheduleType = "interval" | "daily" | "weekly" | "event";

export interface DirectiveScheduleFields {
  scheduleType: DirectiveScheduleType | null;
  intervalMs: number | null;
  scheduleHour: number | null;
  scheduleMinute: number | null;
  scheduleDayOfWeek: number | null;
  scheduleTimeZone: string | null;
}

interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number;
}

// Reads a UTC instant's wall-clock date/time as it appears in `timeZone`.
// hourCycle "h23" is requested specifically because some ICU builds emit
// "24" instead of "00" for midnight under the default hour cycle - `% 24`
// below is the defensive normalization for that, not dead code.
function wallClockPartsInZone(date: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number } {
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

// Converts a wall-clock date+time meant to be read in `timeZone` to the UTC
// instant it represents, via the standard "guess and correct" technique:
// treat the wall-clock fields as if they were already UTC to get a first
// guess, read back what that guessed instant's wall-clock actually is in
// `timeZone`, and shift the guess by the difference. This converges in one
// correction outside of the ~1hr window around a DST transition - an
// acceptable edge case for a personal scheduler (worst case, a directive
// fires up to an hour off on the one day a year its zone's offset changes,
// and self-corrects on the very next occurrence).
function zonedWallClockToUtc(date: CalendarDate, hour: number, minute: number, timeZone: string): number {
  const guess = Date.UTC(date.year, date.month - 1, date.day, hour, minute, 0, 0);
  const actual = wallClockPartsInZone(new Date(guess), timeZone);
  const actualAsIfUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, 0, 0);
  return guess + (guess - actualAsIfUtc);
}

// The calendar date (Y/M/D) `afterMs` falls on when read in `timeZone` -
// the starting point for the day-by-day search below.
function calendarDateInZone(afterMs: number, timeZone: string): CalendarDate {
  const parts = wallClockPartsInZone(new Date(afterMs), timeZone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

// Day-by-day search, walking forward or backward from `pivotMs`'s own
// calendar day, for the nearest instant whose local wall clock in
// `timeZone` reads `hour:minute` - and, when `dayOfWeek` is given (0 Sunday
// - 6 Saturday), additionally falls on that weekday - that's strictly after
// `pivotMs` (`direction: "forward"`) or strictly before it (`"backward"`).
// A calendar date's day-of-week is time-zone independent once its Y/M/D is
// fixed (day N is the same weekday everywhere), so it's read via plain UTC
// arithmetic on the candidate date rather than another zoned lookup.
// Bounded to 8 days - more than enough margin for a weekly search (worst
// case 7 days) plus one for DST-transition edge cases. Shared by
// nextOccurrence (a directive's own due-time) and previousOccurrence (the
// progress ring's cycle-start anchor, see directives.ts#toSummary) - same
// math, opposite direction.
function searchOccurrence(hour: number, minute: number, timeZone: string, pivotMs: number, direction: "forward" | "backward", dayOfWeek?: number): number {
  const anchor = calendarDateInZone(pivotMs, timeZone);
  const step = direction === "forward" ? 1 : -1;
  for (let offset = 0; offset <= 8; offset++) {
    const candidateUtcMidnight = Date.UTC(anchor.year, anchor.month - 1, anchor.day + offset * step);
    const candidate = new Date(candidateUtcMidnight);
    if (dayOfWeek !== undefined && candidate.getUTCDay() !== dayOfWeek) continue;
    const instant = zonedWallClockToUtc(
      { year: candidate.getUTCFullYear(), month: candidate.getUTCMonth() + 1, day: candidate.getUTCDate() },
      hour,
      minute,
      timeZone
    );
    if (direction === "forward" ? instant > pivotMs : instant < pivotMs) return instant;
  }
  throw new Error(`searchOccurrence: no matching day found within search window for ${timeZone} ${hour}:${minute} dayOfWeek=${dayOfWeek}`);
}

function nextOccurrence(hour: number, minute: number, timeZone: string, afterMs: number, dayOfWeek?: number): number {
  return searchOccurrence(hour, minute, timeZone, afterMs, "forward", dayOfWeek);
}

// The occurrence immediately before `beforeMs` - one schedule period back.
// Used to anchor the progress ring's "current cycle" for daily/weekly
// directives at the true previous wall-clock slot ("yesterday at 9am")
// rather than at whatever `lastRunAt`/`createdAt` happen to be - see
// directives.ts#toSummary for why those two can't be trusted for this.
export function previousOccurrence(hour: number, minute: number, timeZone: string, beforeMs: number, dayOfWeek?: number): number {
  return searchOccurrence(hour, minute, timeZone, beforeMs, "backward", dayOfWeek);
}

// Every timestamp (ms since epoch) this directive's own timer should next
// fire at, or null if it has none (manual-only, or "event" - an
// event-triggered directive runs immediately when its trigger event
// arrives, see eventReceive.ts, never on this periodic timer). A never-run
// "interval" directive is due immediately (anchored at epoch 0, the
// pre-existing behavior); "daily"/"weekly" instead anchor at
// `lastRunAt ?? createdAt` and search strictly forward - picking a specific
// time of day implies "wait for that time", unlike a blank interval.
export function nextRunAt(schedule: DirectiveScheduleFields, lastRunAt: number | null, createdAt: number): number | null {
  switch (schedule.scheduleType) {
    case "interval":
      return (lastRunAt ?? 0) + (schedule.intervalMs as number);
    case "daily":
      return nextOccurrence(schedule.scheduleHour as number, schedule.scheduleMinute as number, schedule.scheduleTimeZone as string, lastRunAt ?? createdAt);
    case "weekly":
      return nextOccurrence(
        schedule.scheduleHour as number,
        schedule.scheduleMinute as number,
        schedule.scheduleTimeZone as string,
        lastRunAt ?? createdAt,
        schedule.scheduleDayOfWeek as number
      );
    case "event":
    case null:
      return null;
  }
}
