export function confirmDelete(label: string): boolean {
  return window.confirm(`Delete "${label}"? This cannot be undone.`);
}
