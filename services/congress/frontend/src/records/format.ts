export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// A filename as a title: extension dropped, separators spaced.
export function titleFromFilename(name: string): string {
  const base = name.replace(/\.[^./]{1,8}$/, "");
  return base.replace(/[_]+/g, " ").trim() || name;
}
