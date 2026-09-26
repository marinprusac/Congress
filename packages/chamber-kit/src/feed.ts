// Shared phrasing for home-feed reasons ("Starts in 25 min", "Overdue by
// 2 h"), so every Chamber's feed candidates read the same way. Rounded
// coarsely on purpose - the feed is a glance, not a countdown.
export function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(Math.abs(ms) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} days`;
}

// Linear 0..1 closeness of `ms` to zero within `windowMs` (1 = now, 0 = at
// or past the window edge) - for scaling a candidate's score by how soon
// something happens.
export function closeness(ms: number, windowMs: number): number {
  if (ms <= 0) return 1;
  if (ms >= windowMs) return 0;
  return 1 - ms / windowMs;
}
