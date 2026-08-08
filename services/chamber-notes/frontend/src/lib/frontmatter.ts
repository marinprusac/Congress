const FRONTMATTER_FENCE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

export function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER_FENCE, "").replace(/^\s+/, "");
}
