// How far behind wall-clock time the newest fix has to be before the map
// says so. Deliberately independent of the Chamber's own staleThresholdMs
// setting, which answers a different question: that one decides when to push
// a notification (and so is tuned generously to avoid crying wolf), while
// this one only decides whether the screen is allowed to present a position
// as if it were current. A map quietly showing a two-hour-old location as
// "where you are" is the failure worth avoiding here, and it costs nothing to
// be honest about it well before anything is worth alerting on.
const NOTEWORTHY_LAG_MS = 20 * 60 * 1000;

export interface Freshness {
  lagMs: number;
  stale: boolean;
  label: string;
}

function humanizeLag(lagMs: number): string {
  const minutes = Math.floor(lagMs / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
  const days = Math.floor(hours / 24);
  const leftoverHours = hours % 24;
  return leftoverHours === 0 ? `${days}d` : `${days}d ${leftoverHours}h`;
}

// Null when there's nothing worth saying: no fix has ever been recorded (a
// brand-new install has no location to be wrong about), or the newest one is
// recent enough that the map is simply current. A lag measured as negative -
// a device whose clock runs ahead of the server's - reads as fresh rather
// than as a nonsense "-3 min ago".
export function trackingFreshness(lastProcessedAt: string | null, now: Date = new Date()): Freshness | null {
  if (!lastProcessedAt) return null;
  const at = new Date(lastProcessedAt);
  if (Number.isNaN(at.getTime())) return null;
  const lagMs = now.getTime() - at.getTime();
  if (lagMs < NOTEWORTHY_LAG_MS) return null;
  return { lagMs, stale: true, label: `Location is ${humanizeLag(lagMs)} old` };
}
