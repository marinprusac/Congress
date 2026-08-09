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
