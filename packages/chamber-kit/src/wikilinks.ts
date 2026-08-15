import { parseExhibitToken } from "@congress/shared-types";

export const WIKILINK_PATTERN = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

// Outgoing refs are bare Exhibit ids (e.g. "note-3"), matching the id space
// used by exhibit_cache/exhibit_refs - not the "exhibit:chamber:id" token
// syntax, which only exists for embedding a reference in body text.
export function extractOutgoingExhibitRefs(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(WIKILINK_PATTERN)) {
    const target = match[1]?.trim();
    if (!target) continue;
    const parsed = parseExhibitToken(target);
    if (parsed) ids.add(parsed.id);
  }
  return [...ids];
}
