import { WIKILINK_PATTERN } from "@congress/chamber-kit";

export interface ParsedWikiLink {
  target: string;
  alias: string | null;
}

export function extractWikiLinks(markdown: string): ParsedWikiLink[] {
  const links: ParsedWikiLink[] = [];
  for (const match of markdown.matchAll(WIKILINK_PATTERN)) {
    const target = match[1]?.trim();
    if (!target) continue;
    const alias = match[2]?.trim() || null;
    links.push({ target, alias });
  }
  return links;
}

export function makeExcerpt(body: string, maxLength = 180): string {
  const plain = body
    .replace(WIKILINK_PATTERN, (_match, target: string, alias?: string) => alias?.trim() || target.trim())
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > maxLength ? `${plain.slice(0, maxLength).trimEnd()}…` : plain;
}
