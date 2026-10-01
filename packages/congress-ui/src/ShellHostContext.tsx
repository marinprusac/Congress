// A record's or view's path within its namespace ("e", "map", ...) made
// absolute. The one place that writes the "/<namespace><path>" shape; "" (no
// namespace: Congress's own shell chrome) passes the path through.
export function resolveChamberPath(path: string, chamberName: string): string {
  if (!chamberName) return path;
  return path === "/" ? `/${chamberName}` : `/${chamberName}${path}`;
}
