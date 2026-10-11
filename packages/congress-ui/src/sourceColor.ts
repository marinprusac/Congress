import { useSyncExternalStore, type CSSProperties } from "react";
import { hashSourceColor, isSourceColor, type SourceColor } from "@congress/shared-types";

// Colours for sources that are not record types (a connector's own views).
const CHAMBER_COLORS: Readonly<Record<string, SourceColor>> = {
  events: "cobalt",
  fitness: "mint",
  map: "lilac",
  whatsapp: "mint",
  mail: "tomato",
};

// Record type slug -> stored colour, filled once the app has the type list.
let typeColors: ReadonlyMap<string, string> = new Map();
const listeners = new Set<() => void>();

export function setExhibitTypeColors(next: ReadonlyMap<string, string | undefined>): void {
  const map = new Map<string, string>();
  for (const [slug, color] of next) if (color) map.set(slug, color);
  typeColors = map;
  for (const l of listeners) l();
}

// Pure: a record type's own colour, else one derived from its slug; a
// non-record source (chamber) gets its fixed colour, else the neutral ink.
export function pickSourceColor(chamber: string, type: string | undefined, colors: ReadonlyMap<string, string>): SourceColor {
  if (chamber === "e") {
    if (!type) return "ink";
    const stored = colors.get(type);
    return isSourceColor(stored) ? stored : hashSourceColor(type);
  }
  return CHAMBER_COLORS[chamber] ?? "ink";
}

export function useSourceColor(chamber: string, type?: string): SourceColor {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => pickSourceColor(chamber, type, typeColors)
  );
}

// --src is the fill, --on-src the text colour that reads on it.
export function sourceColorStyle(color: SourceColor): CSSProperties {
  return {
    "--src": `var(--color-src-${color})`,
    "--on-src": color === "cobalt" ? "var(--on-src-cobalt)" : color === "ink" ? "var(--color-parchment)" : "#111110",
  } as CSSProperties;
}
