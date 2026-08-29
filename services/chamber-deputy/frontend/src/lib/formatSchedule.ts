import type { DirectiveSummary } from "../../../src/types";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayLabel(dayOfWeek: number): string {
  return DAY_LABELS[dayOfWeek] ?? "?";
}

function formatTimeOfDay(hour: number, minute: number): string {
  const twelveHour = hour % 12 === 0 ? 12 : hour % 12;
  const period = hour < 12 ? "AM" : "PM";
  return `${twelveHour}:${String(minute).padStart(2, "0")} ${period}`;
}

// Minutes for a clean multiple of an hour/day, otherwise raw minutes - just
// enough to make an interval schedule scannable without a full
// duration-formatting utility for what's always a short round number.
function formatIntervalMs(intervalMs: number): string {
  const minutes = Math.round(intervalMs / 60_000);
  if (minutes % 1440 === 0) return `every ${minutes / 1440}d`;
  if (minutes % 60 === 0) return `every ${minutes / 60}h`;
  return `every ${minutes}m`;
}

type ScheduleFields = Pick<DirectiveSummary, "scheduleType" | "intervalMs" | "scheduleHour" | "scheduleMinute" | "scheduleDayOfWeek" | "triggerEventType">;

// A short, scannable label for a directive's own schedule - shared by the
// list page (one line per row) and the view page's non-edit summary. null
// for manual/chat-only (nothing to show).
export function formatSchedule(directive: ScheduleFields): string | null {
  switch (directive.scheduleType) {
    case "interval":
      return directive.intervalMs != null ? formatIntervalMs(directive.intervalMs) : null;
    case "daily":
      return directive.scheduleHour != null && directive.scheduleMinute != null
        ? `daily ${formatTimeOfDay(directive.scheduleHour, directive.scheduleMinute)}`
        : null;
    case "weekly":
      return directive.scheduleHour != null && directive.scheduleMinute != null && directive.scheduleDayOfWeek != null
        ? `${dayLabel(directive.scheduleDayOfWeek)} ${formatTimeOfDay(directive.scheduleHour, directive.scheduleMinute)}`
        : null;
    case "event":
      return directive.triggerEventType ? `on ${directive.triggerEventType}` : null;
    default:
      return null;
  }
}
