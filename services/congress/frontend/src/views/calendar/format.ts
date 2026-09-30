// Labels for the calendar views, in the browser's own locale and zone.

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
