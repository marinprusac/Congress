import { parseRecordToken } from "@congress/shared-types";
import { WIKILINK_PATTERN } from "./textSegments.js";

export const RECORD_HREF_PREFIX = "record:";
export const isRecordHref = (href: string) => href.startsWith(RECORD_HREF_PREFIX) || href.startsWith("exhibit:");

// Rewrites `[[record:chamber:id|Label]]` tokens into Markdown links with an
// `record:` href, so the Markdown renderer hands them to the chip component.
export function recordTokensToLinks(text: string): string {
  return text.replace(WIKILINK_PATTERN, (full, rawTarget: string, rawAlias?: string) => {
    // Inside a Markdown table the pipe is written escaped: [[record:x:y\|Label]].
    const target = rawTarget.trim().replace(/\\$/, "");
    const parsed = parseRecordToken(target);
    if (!parsed) return full;
    const label = (rawAlias?.trim() || parsed.id).replace(/([\\[\]])/g, "\\$1");
    return `[${label}](<${target.replace(/[<>]/g, encodeURIComponent)}>)`;
  });
}

// While a reply streams, hide a half-written token at the very end rather
// than flashing its raw syntax.
export function trimPartialToken(text: string): string {
  return text.replace(/\[\[[^\]]*\]?$/, "");
}
