import { parseExhibitToken } from "@congress/shared-types";

const WIKILINK_PATTERN = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

// Internal marker scheme (not a real URL scheme) - lets NoteMarkdown's
// urlTransform bypass and `a` component override tell an Exhibit reference
// apart from a genuine external link.
export const EXHIBIT_LINK_SCHEME = "exhibit-ref:";

// Converts `[[exhibit:chamber:id|Label]]` tokens (see @congress/shared-types
// buildExhibitToken/parseExhibitToken) into markdown links react-markdown can
// render. Anything that isn't a valid Exhibit token is left as literal text -
// after the wikilink-to-Exhibit migration, every `[[...]]` in a note body is
// expected to already be a token.
export function toMarkdownWithExhibitLinks(body: string): string {
  return body.replace(WIKILINK_PATTERN, (match, rawTarget: string, rawAlias?: string) => {
    const target = rawTarget.trim();
    if (!parseExhibitToken(target)) return match;
    const label = rawAlias?.trim() || target;
    return `[${label}](${EXHIBIT_LINK_SCHEME}${encodeURIComponent(target)})`;
  });
}

export function decodeExhibitLinkHref(href: string): string | null {
  if (!href.startsWith(EXHIBIT_LINK_SCHEME)) return null;
  return decodeURIComponent(href.slice(EXHIBIT_LINK_SCHEME.length));
}

// Unique list of valid Exhibit tokens referenced in a note body, in
// first-seen order - used to batch-resolve before rendering.
export function extractExhibitTokens(body: string): string[] {
  const tokens = new Set<string>();
  for (const match of body.matchAll(WIKILINK_PATTERN)) {
    const target = match[1]?.trim();
    if (target && parseExhibitToken(target)) tokens.add(target);
  }
  return [...tokens];
}
