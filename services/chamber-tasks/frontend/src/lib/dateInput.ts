// A bare "YYYY-MM-DD" string (what <input type="date"> both reads and
// writes) is parsed by `new Date()` as UTC midnight, per spec - so sending
// it to the server as-is and letting it call `new Date(dueDate)` silently
// shifts the due instant by the browser's own UTC offset (2 hours during
// Zagreb's CEST), making due/overdue notifications fire that many hours
// late. Appending a bare "T00:00:00" (no offset) instead makes `new Date()`
// resolve it against *this* browser's local timezone, matching what the
// picker actually shows the user.
export function dateInputToIso(value: string): string {
  return new Date(`${value}T00:00:00`).toISOString();
}

// Inverse of dateInputToIso - reads the ISO instant's local calendar date
// (not its UTC date, which can land on the previous day near local
// midnight) back into a <input type="date"> value.
export function isoToDateInput(iso: string): string {
  const d = new Date(iso);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
