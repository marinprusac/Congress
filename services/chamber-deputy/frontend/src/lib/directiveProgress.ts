// How far a scheduled directive is through its current cycle, as a 0..1
// fraction - 0 at the cycle's start, 1 once it's due. For "daily"/"weekly",
// the cycle start is `scheduleCycleStart` (scheduling.ts#previousOccurrence,
// computed server-side as one schedule period before nextRunAt - "yesterday
// at 9am" for a "daily at 9am" directive) rather than `lastRunAt`: a
// directive's actual run history can fall short of its own schedule (never
// having fired yet, a manual run, a catch-up after downtime), but the
// wall-clock rhythm a "daily at 9am" directive is due against runs
// 9am-to-9am regardless of any of that - so the ring reflects the schedule,
// not the run log. `lastRunAt` (falling back to `createdAt` if never run)
// remains the anchor for "interval": there, unlike daily/weekly, the
// schedule *is* defined relative to the last run (nextRunAt is literally
// `lastRunAt + intervalMs`, scheduling.ts), so anchoring anywhere else would
// contradict the schedule itself, not just visually diverge from it. null
// for a directive with no periodic schedule of its own at all (manual/chat-
// only, or "event" - nextRunAt is null for both, see directives.ts) - there's
// no "next trigger" to show progress toward.
export function directiveProgressFraction(
  lastRunAt: string | null,
  nextRunAt: string | null,
  createdAt: string,
  scheduleCycleStart: string | null,
  now: number
): number | null {
  if (nextRunAt == null) return null;
  const lastAt = scheduleCycleStart
    ? new Date(scheduleCycleStart).getTime()
    : lastRunAt
      ? new Date(lastRunAt).getTime()
      : new Date(createdAt).getTime();
  const dueAt = new Date(nextRunAt).getTime();
  if (dueAt <= lastAt) return 1;
  const fraction = (now - lastAt) / (dueAt - lastAt);
  return Math.min(1, Math.max(0, fraction));
}
