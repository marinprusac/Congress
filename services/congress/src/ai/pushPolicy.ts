// Pure time helpers for when an ask may buzz the owner's devices.

function localParts(at: Date, timeZone: string | null): { hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timeZone ?? undefined,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { hour: get("hour"), minute: get("minute"), second: get("second") };
}

// [start, end) in local hours, wrapping past midnight; equal or null = none.
export function inQuietHours(at: Date, start: number | null, end: number | null, timeZone: string | null): boolean {
  if (start === null || end === null || start === end) return false;
  const { hour } = localParts(at, timeZone);
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

// Local midnight of `at`'s day (an hour off on a DST-change day at worst).
export function startOfLocalDay(at: Date, timeZone: string | null): Date {
  const { hour, minute, second } = localParts(at, timeZone);
  return new Date(at.getTime() - ((hour * 60 + minute) * 60 + second) * 1000 - at.getMilliseconds());
}

export type PushDecision = "push" | "quiet_hours" | "over_cap" | "quiet";

export function decidePush(opts: {
  urgency: "quiet" | "push";
  at: Date;
  pushedToday: number;
  maxPushesPerDay: number;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  timeZone: string | null;
}): PushDecision {
  if (opts.urgency !== "push") return "quiet";
  if (inQuietHours(opts.at, opts.quietHoursStart, opts.quietHoursEnd, opts.timeZone)) return "quiet_hours";
  if (opts.pushedToday >= opts.maxPushesPerDay) return "over_cap";
  return "push";
}
