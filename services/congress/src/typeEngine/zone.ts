import { env } from "../env.js";

// The owner's time zone and calendar-day math for `date` fields. A date is a
// day, not an instant; these turn it into the instants triggers and feeds use.

let cachedZone: string | null = null;

// AI settings' zone when set, else OWNER_TIMEZONE (see refreshOwnerZone).
export function ownerZone(): string {
  return cachedZone ?? env.OWNER_TIMEZONE;
}

export async function refreshOwnerZone(): Promise<void> {
  const { getAiSettings } = await import("../ai/settings.js");
  cachedZone = (await getAiSettings()).timeZone ?? null;
}

export function setOwnerZoneForTests(zone: string | null): void {
  cachedZone = zone;
}

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function partsIn(ms: number, zone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

// The calendar day an instant falls on in `zone`, as YYYY-MM-DD.
export function dayOf(ms: number, zone = ownerZone()): string {
  const { year, month, day } = partsIn(ms, zone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Local midnight starting `date` in `zone`. Guesses as if the zone were UTC,
// then corrects by the zone's offset twice so a DST switch that night settles.
export function startOfDay(date: string, zone = ownerZone()): number {
  return wallTime(date, 0, 0, zone);
}

// The instant a local wall-clock time on `date` names in `zone`.
export function wallTime(date: string, hour: number, minute: number, zone = ownerZone()): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const target = Date.UTC(y, m - 1, d, hour, minute);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const p = partsIn(guess, zone);
    guess += target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  }
  return guess;
}

// The instant a day is over: the next local midnight.
export function endOfDay(date: string, zone = ownerZone()): number {
  return startOfDay(addDays(date, 1), zone);
}
