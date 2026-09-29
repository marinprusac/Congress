// ISO <-> the local wall-clock value <input type="datetime-local"> wants.
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(local: string): string | null {
  if (!local) return null;
  const ms = new Date(local).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
