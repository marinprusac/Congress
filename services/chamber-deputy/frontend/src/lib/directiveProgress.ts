// How far a scheduled directive is through its current cycle, as a 0..1
// fraction - 0 right after it last ran (or was created, if it's never run),
// 1 once it's due. `createdAt` anchors a never-run directive's own start of
// its first cycle - required for "daily"/"weekly" (whose own nextRunAt,
// scheduling.ts, is a real future wall-clock instant, not intervalMs-away
// from an epoch anchor the way a never-run "interval" directive's is) so a
// freshly created one doesn't render as already almost due. A never-run
// "interval" directive still renders as immediately due despite this same
// createdAt anchor: its own nextRunAt is `intervalMs` (an epoch-relative
// value, see scheduling.ts), always in the past relative to any real
// createdAt, so the `dueAt <= lastAt` guard below still fires - same
// "already due" visual the old epoch-0 anchor gave it. null for a directive
// with no periodic schedule of its own at all (manual/chat-only, or
// "event" - nextRunAt is null for both, see directives.ts) - there's no
// "next trigger" to show progress toward.
export function directiveProgressFraction(lastRunAt: string | null, nextRunAt: string | null, createdAt: string, now: number): number | null {
  if (nextRunAt == null) return null;
  const lastAt = lastRunAt ? new Date(lastRunAt).getTime() : new Date(createdAt).getTime();
  const dueAt = new Date(nextRunAt).getTime();
  if (dueAt <= lastAt) return 1;
  const fraction = (now - lastAt) / (dueAt - lastAt);
  return Math.min(1, Math.max(0, fraction));
}
