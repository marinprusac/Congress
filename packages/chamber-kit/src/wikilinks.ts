import { buildExhibitToken, parseExhibitToken, type ExhibitToken } from "@congress/shared-types";

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

// Every distinct exhibit token in a body, alongside the alias it was
// embedded with - the alias is the fallback label used when a live resolve
// can't reach the owning Chamber (see chamber-calendar's
// richTextMirror.projectRichToPlain, the first consumer of this).
export function extractExhibitTokensWithLabels(text: string): Array<ExhibitToken & { token: string; label: string }> {
  const seen = new Map<string, ExhibitToken & { token: string; label: string }>();
  for (const match of text.matchAll(WIKILINK_PATTERN)) {
    const target = match[1]?.trim();
    if (!target) continue;
    const parsed = parseExhibitToken(target);
    if (!parsed) continue;
    const token = buildExhibitToken(parsed);
    if (!seen.has(token)) seen.set(token, { ...parsed, token, label: (match[2] ?? "").trim() || parsed.id });
  }
  return [...seen.values()];
}
