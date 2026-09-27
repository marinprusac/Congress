// A due date is a calendar day, not an instant: a task due 13 March is due
// until that day ends in the owner's time zone. The stored instant only
// names the day - it may be local midnight (the editor) or UTC midnight
// (a bare "YYYY-MM-DD" over MCP), and both land on the same local day.

function partsIn(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

// The owner's calendar day the stored instant falls on, as "YYYY-MM-DD".
export function dueDay(stored: Date, timeZone: string): string {
  const { year, month, day } = partsIn(stored, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// The instant the task becomes overdue: the start of the next day in `timeZone`.
export function dueDeadline(stored: Date, timeZone: string): Date {
  const { year, month, day } = partsIn(stored, timeZone);
  // Guess next midnight as if the zone were UTC, then correct by the zone's
  // offset at that guess (twice, so a DST switch that night settles).
  const target = Date.UTC(year, month - 1, day + 1);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const p = partsIn(new Date(guess), timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += target - asUtc;
  }
  return new Date(guess);
}
