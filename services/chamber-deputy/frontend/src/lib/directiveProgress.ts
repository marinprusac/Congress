// How far a scheduled directive is through its current interval, as a
// 0..1 fraction - 0 right after it last ran, 1 once it's due (matching
// checkup.ts's own dueAt() on the backend: a never-run directive is treated
// as due immediately, i.e. lastRunAt of "epoch"). null for a directive with
// no interval of its own (on-demand/chat-only) - there's no "next trigger"
// to show progress toward.
export function directiveProgressFraction(lastRunAt: string | null, intervalMs: number | null, now: number): number | null {
  if (intervalMs == null) return null;
  const lastAt = lastRunAt ? new Date(lastRunAt).getTime() : 0;
  const fraction = (now - lastAt) / intervalMs;
  return Math.min(1, Math.max(0, fraction));
}
