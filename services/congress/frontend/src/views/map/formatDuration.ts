// "83 min" reads fine short, but a multi-hour dwell/trip is easier to parse
// as "1h 23min" than as a raw three-digit minute count.
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h ${rest}min`;
}
