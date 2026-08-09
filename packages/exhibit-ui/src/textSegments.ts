import { parseExhibitToken } from "@congress/shared-types";

// Same bracket syntax as Notes' original wikilinks: `[[target|alias]]`,
// where `target` is expected to be an `exhibit:chamber:id` token (see
// buildExhibitToken/parseExhibitToken in @congress/shared-types).
const WIKILINK_PATTERN = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

// Unique list of valid Exhibit tokens referenced in a body of text, in
// first-seen order - used to batch-resolve before rendering.
export function extractExhibitTokens(text: string): string[] {
  const tokens = new Set<string>();
  for (const match of text.matchAll(WIKILINK_PATTERN)) {
    const target = match[1]?.trim();
    if (target && parseExhibitToken(target)) tokens.add(target);
  }
  return [...tokens];
}

export type ExhibitTextSegment =
  | { type: "text"; value: string }
  | { type: "exhibit"; token: string; label: string };

// Splits plain text into an ordered sequence of text/exhibit-reference
// segments - for chambers that want inline reference chips without a full
// Markdown pipeline (see <ExhibitAnnotatedText>). A `[[...]]` span whose
// target isn't a valid Exhibit token is left as literal text, same
// leave-it-alone behavior as `extractExhibitTokens`.
export function splitExhibitText(text: string): ExhibitTextSegment[] {
  const segments: ExhibitTextSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(WIKILINK_PATTERN)) {
    const [full, rawTarget, rawAlias] = match;
    const target = rawTarget?.trim();
    if (!target || !parseExhibitToken(target)) continue;

    const start = match.index ?? 0;
    if (start > lastIndex) segments.push({ type: "text", value: text.slice(lastIndex, start) });
    segments.push({ type: "exhibit", token: target, label: rawAlias?.trim() || target });
    lastIndex = start + full.length;
  }

  if (lastIndex < text.length) segments.push({ type: "text", value: text.slice(lastIndex) });
  return segments;
}
