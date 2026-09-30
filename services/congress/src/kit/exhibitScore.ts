// Relevance tiers for exhibit search, shared by every source so their results merge into one ranked list.

export interface ExhibitMatchField {
  text: string;
  // true for a title-equivalent field (eligible for the top four tiers:
  // exact/prefix/word-boundary/substring); false for a body-equivalent
  // field (only ever word-boundary/substring - a body that happens to equal
  // the query verbatim isn't the same signal as an exact title match).
  isPrimary: boolean;
}

// Six tiers, highest first. Deliberately plain integers (not a weighted sum)
// - only relative order matters, and every caller (the table-backed search()
// below, calendar's hand-rolled search) uses this same function, so tiers
// compare correctly across Chambers once Congress merges their results.
export const EXHIBIT_MATCH_WEIGHT = {
  titleExact: 6,
  titlePrefix: 5,
  titleWordBoundary: 4,
  titleSubstring: 3,
  bodyWordBoundary: 2,
  bodySubstring: 1,
  none: 0,
} as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The one place relevance is scored, so notes/documents/map/automation/
// tasks/deputy/fitness (via search() below) and calendar (hand-rolled, no
// local table to speak of) agree on what "a better match" means without
// duplicating the tier logic per Chamber.
export function scoreExhibitMatch(query: string, fields: ExhibitMatchField[]): number {
  const q = query.trim().toLowerCase();
  if (!q) return EXHIBIT_MATCH_WEIGHT.none;
  const wordBoundaryRe = new RegExp(`\\b${escapeRegExp(q)}\\b`, "i");

  let best: number = EXHIBIT_MATCH_WEIGHT.none;
  for (const field of fields) {
    const text = field.text.toLowerCase();
    if (!text) continue;
    if (field.isPrimary) {
      if (text === q) return EXHIBIT_MATCH_WEIGHT.titleExact; // can't beat this
      if (text.startsWith(q)) best = Math.max(best, EXHIBIT_MATCH_WEIGHT.titlePrefix);
      else if (wordBoundaryRe.test(field.text)) best = Math.max(best, EXHIBIT_MATCH_WEIGHT.titleWordBoundary);
      else if (text.includes(q)) best = Math.max(best, EXHIBIT_MATCH_WEIGHT.titleSubstring);
    } else {
      if (wordBoundaryRe.test(field.text)) best = Math.max(best, EXHIBIT_MATCH_WEIGHT.bodyWordBoundary);
      else if (text.includes(q)) best = Math.max(best, EXHIBIT_MATCH_WEIGHT.bodySubstring);
    }
  }
  return best;
}
