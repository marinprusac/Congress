// A time block's moment or range in the owner's own zone (the browser's).
export function formatBlockTime(time: { start: string; end?: string; allDay?: boolean }, now = new Date()): string {
  const start = new Date(time.start);
  const end = time.end ? new Date(time.end) : null;
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const day = (d: Date) => {
    const tomorrow = new Date(now.getTime() + 86_400_000);
    if (sameDay(d, now)) return "Today";
    if (sameDay(d, tomorrow)) return "Tomorrow";
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  };
  const clock = (d: Date) => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (time.allDay) return end && !sameDay(start, end) ? `${day(start)} – ${day(end)}` : day(start);
  if (!end) return `${day(start)}, ${clock(start)}`;
  if (sameDay(start, end)) return `${day(start)}, ${clock(start)} – ${clock(end)}`;
  return `${day(start)}, ${clock(start)} – ${day(end)}, ${clock(end)}`;
}
