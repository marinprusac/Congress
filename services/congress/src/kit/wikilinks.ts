import { buildRecordToken, parseRecordToken, type RecordToken } from "@congress/shared-types";

export const WIKILINK_PATTERN = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

// Outgoing refs are bare Record ids (e.g. "note-3"), matching the id space
// used by exhibit_cache/exhibit_refs - not the "record:chamber:id" token
// syntax, which only exists for embedding a reference in body text.
export function extractOutgoingRecordRefs(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(WIKILINK_PATTERN)) {
    // A pipe escaped for a Markdown table cell leaves "\\" on the target.
    const target = match[1]?.trim().replace(/\\$/, "");
    if (!target) continue;
    const parsed = parseRecordToken(target);
    if (parsed) ids.add(parsed.id);
  }
  return [...ids];
}

// Every distinct record token in a body, alongside the alias it was
// embedded with - the alias is the fallback label used when a live resolve
// can't reach the owning Chamber (see chamber-calendar's
// richTextMirror.projectRichToPlain, the first consumer of this).
export function extractRecordTokensWithLabels(text: string): Array<RecordToken & { token: string; label: string }> {
  const seen = new Map<string, RecordToken & { token: string; label: string }>();
  for (const match of text.matchAll(WIKILINK_PATTERN)) {
    // A pipe escaped for a Markdown table cell leaves "\\" on the target.
    const target = match[1]?.trim().replace(/\\$/, "");
    if (!target) continue;
    const parsed = parseRecordToken(target);
    if (!parsed) continue;
    const token = buildRecordToken(parsed);
    if (!seen.has(token)) seen.set(token, { ...parsed, token, label: (match[2] ?? "").trim() || parsed.id });
  }
  return [...seen.values()];
}
