// The colours a type (a "source" in the feed) can carry. Keys, not hex, so
// each theme can tune its own value (see the --color-src-* tokens).
export const SOURCE_COLORS = ["cobalt", "tomato", "mint", "mustard", "lilac", "ink"] as const;
export type SourceColor = (typeof SOURCE_COLORS)[number];

const KNOWN = new Set<string>(SOURCE_COLORS);

export function isSourceColor(value: unknown): value is SourceColor {
  return typeof value === "string" && KNOWN.has(value);
}

// A stable colour for a type that has none stored: the same slug always maps
// to the same key. "ink" is left out, it is the neutral every uncoloured
// thing already has.
export function hashSourceColor(slug: string): SourceColor {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  const bright = SOURCE_COLORS.filter((c) => c !== "ink");
  return bright[h % bright.length]!;
}
