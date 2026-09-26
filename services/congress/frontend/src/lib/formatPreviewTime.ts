import type { FeedPreview } from "@congress/shared-types";

type PreviewTime = NonNullable<FeedPreview["time"]>;

function dayWord(date: Date, now: Date): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

const clock = (d: Date) => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

// A feed preview's time, in the browser's own time zone (the server only
// ever sends ISO timestamps): "Due Today 15:00", "Tomorrow 09:00 – 10:30",
// "Sat 27 Sep" for an all-day event. `now` is injectable for tests.
export function formatPreviewTime(time: PreviewTime, now = new Date()): string {
  const prefix = time.label ? `${time.label} ` : "";
  if (time.allDay) {
    // All-day dates are plain "YYYY-MM-DD" - read them as local dates, not UTC.
    const [y, m, d] = time.start.slice(0, 10).split("-").map(Number);
    return `${prefix}${dayWord(new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1), now)}`;
  }
  const start = new Date(time.start);
  let text = `${prefix}${dayWord(start, now)} ${clock(start)}`;
  if (time.end) {
    const end = new Date(time.end);
    text += dayWord(end, now) === dayWord(start, now) ? ` – ${clock(end)}` : ` – ${dayWord(end, now)} ${clock(end)}`;
  }
  return text;
}
