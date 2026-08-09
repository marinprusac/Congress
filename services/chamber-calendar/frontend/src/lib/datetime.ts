import type { CalendarEvent } from "@congress/shared-types";

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

export interface EventDayGroup {
  dateKey: string;
  dateLabel: string;
  events: CalendarEvent[];
}

const DAY_LABEL_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

export function groupEventsByDay(events: CalendarEvent[]): EventDayGroup[] {
  const groups = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = dayKey(event);
    const list = groups.get(key) ?? [];
    list.push(event);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, dayEvents]) => ({
      dateKey,
      dateLabel: DAY_LABEL_FORMAT.format(new Date(`${dateKey}T00:00:00`)),
      events: dayEvents,
    }));
}

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

export function formatEventTime(event: CalendarEvent): string {
  if (event.allDay) return "All day";
  return `${TIME_FORMAT.format(new Date(event.start))} – ${TIME_FORMAT.format(new Date(event.end))}`;
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
