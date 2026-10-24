import { parseRecordToken } from "@congress/shared-types";

// Same bracket syntax as Notes' original wikilinks: `[[target|alias]]`,
// where `target` is expected to be an `record:chamber:id` token (see
// buildRecordToken/parseRecordToken in @congress/shared-types). Exported so
// the CM6 chip-decoration ViewPlugin (codemirror/recordChipDecorations.ts)
// scans for the exact same syntax rather than a fifth duplicated copy.
export const WIKILINK_PATTERN = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

// Unique list of valid Record tokens referenced in a body of text, in
// first-seen order - used to batch-resolve before rendering.
export function extractRecordTokens(text: string): string[] {
  const tokens = new Set<string>();
  for (const match of text.matchAll(WIKILINK_PATTERN)) {
    const target = match[1]?.trim();
    if (target && parseRecordToken(target)) tokens.add(target);
  }
  return [...tokens];
}

export type RecordTextSegment =
  | { type: "text"; value: string }
  | { type: "record"; token: string; label: string };

// Splits plain text into an ordered sequence of text/record-reference
// segments - for chambers that want inline reference chips without a full
// Markdown pipeline (see <RecordAnnotatedText>). A `[[...]]` span whose
// target isn't a valid Record token is left as literal text, same
// leave-it-alone behavior as `extractRecordTokens`.
export function splitRecordText(text: string): RecordTextSegment[] {
  const segments: RecordTextSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(WIKILINK_PATTERN)) {
    const [full, rawTarget, rawAlias] = match;
    const target = rawTarget?.trim();
    if (!target || !parseRecordToken(target)) continue;

    const start = match.index ?? 0;
    if (start > lastIndex) segments.push({ type: "text", value: text.slice(lastIndex, start) });
    segments.push({ type: "record", token: target, label: rawAlias?.trim() || target });
    lastIndex = start + full.length;
  }

  if (lastIndex < text.length) segments.push({ type: "text", value: text.slice(lastIndex) });
  return segments;
}
