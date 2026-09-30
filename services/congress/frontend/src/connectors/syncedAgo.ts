// "Synced 3 min ago" for a connector's status line.
export function syncedAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return "Not synced yet";
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "Synced just now";
  if (minutes < 60) return `Synced ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synced ${hours} h ago`;
  return `Synced ${Math.floor(hours / 24)} d ago`;
}
