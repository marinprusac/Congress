// Shell routes that aren't a Chamber (see App.tsx).
const SHELL_ROUTES = new Set(["search", "notifications", "settings", "chat", "capitol", "logs"]);

// The Chamber whose bundle a path needs, if any: "/notes/n/1" and
// "/view/map/today" both need a Chamber's remote entry; "/chat/3" doesn't.
export function chamberForPath(path: string): string | undefined {
  const segments = (path.split(/[?#]/)[0] ?? "").split("/").filter(Boolean);
  const [first, second] = segments;
  if (!first || SHELL_ROUTES.has(first)) return undefined;
  if (first === "view") return second;
  return first;
}
