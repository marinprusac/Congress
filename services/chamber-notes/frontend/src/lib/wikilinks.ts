import type { WikiLink } from "@congress/shared-types";

const WIKILINK_PATTERN = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export const WIKILINK_SCHEME = "wikilink:";

export function toMarkdownWithWikiLinks(body: string): string {
  return body.replace(WIKILINK_PATTERN, (_match, target: string, alias?: string) => {
    const trimmedTarget = target.trim();
    const label = alias?.trim() || trimmedTarget;
    return `[${label}](${WIKILINK_SCHEME}${encodeURIComponent(trimmedTarget)})`;
  });
}

export function isWikiLinkResolved(target: string, outgoingLinks: WikiLink[]): boolean {
  const match = outgoingLinks.find((link) => link.target.toLowerCase() === target.toLowerCase());
  return match?.resolved ?? false;
}
