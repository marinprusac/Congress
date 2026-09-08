import type { ExhibitSearchResult, ExhibitResolveResult, ExhibitSyncRequest } from "@congress/shared-types";

function createExhibitIdCodec(prefix: string) {
  function toExhibitId(id: number): string {
    return `${prefix}${id}`;
  }
  function parseId(exhibitId: string): number | null {
    if (!exhibitId.startsWith(prefix)) return null;
    const id = Number(exhibitId.slice(prefix.length));
    return Number.isInteger(id) ? id : null;
  }
  return { toExhibitId, parseId };
}

export function createPushExhibitSync(opts: { chamber: string; capitolUrl: string; internalToken: string }) {
  return async function pushExhibitSync(push: Omit<ExhibitSyncRequest, "chamber">): Promise<void> {
    try {
      const res = await fetch(`${opts.capitolUrl}/congress/exhibits/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Congress-Internal-Token": opts.internalToken,
        },
        body: JSON.stringify({ chamber: opts.chamber, ...push }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        console.warn(`Exhibit sync rejected by Capitol: ${res.status}`);
      }
    } catch (err) {
      console.warn(`Exhibit sync failed: ${(err as Error).message}`);
    }
  };
}

// This factory covers the shape shared by any Chamber whose exhibits are
// rows in one local table with an integer id and a title (notes, documents)
// - a Chamber whose exhibits come from elsewhere (e.g. calendar's events,
// fetched live from Google) doesn't fit this and implements the
// search/resolve contract directly instead.
export interface TableBackedExhibitsConfig<TSearchRow extends { id: number; title: string; body?: string }> {
  idPrefix: string;
  type: string;
  urlFor: (id: number) => string;
  // Raw row queries - kept as passthrough callbacks so this factory never
  // has to genericize over Drizzle's own table/column types.
  searchRows: (pattern: string, limit: number) => TSearchRow[];
  resolveRows: (ids: number[]) => TSearchRow[];
}

export type ChipResult = { id: string; name: string; url: string } | { id: string; deleted: true };

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

// A personal single-user app has dozens/hundreds of rows per table, not
// millions, so widening the SQL candidate window this far and ranking in JS
// (rather than reaching for SQLite FTS5) is the cheap, correct tradeoff -
// it's also the only way to get word-boundary matching at all, since that
// needs a regex no LIKE pattern can express.
const SEARCH_CANDIDATE_LIMIT = 200;

export function createTableBackedExhibits<TSearchRow extends { id: number; title: string; body?: string }>(
  config: TableBackedExhibitsConfig<TSearchRow>
) {
  const { toExhibitId, parseId } = createExhibitIdCodec(config.idPrefix);

  // An empty query matches everything ("%%"), which combined with the
  // most-recent-first ordering chambers use in searchRows is exactly the
  // "show me what's there" listing the picker wants before the user has
  // typed anything - no scoring applies, so there's no reason to widen the
  // candidate window beyond what will actually be shown.
  //
  // A non-empty query instead pulls a wide, still-recency-ordered candidate
  // set, scores every row, and stable-sorts by score descending - stability
  // preserves searchRows' own recency order as the tie-break for free, so an
  // exact title match can never be pushed out of the result by a merely
  // more-recently-touched body substring hit.
  async function search(query: string, limit = 10): Promise<ExhibitSearchResult[]> {
    const trimmedQuery = query.trim();
    const pattern = `%${query}%`;
    const rows = config.searchRows(pattern, trimmedQuery ? SEARCH_CANDIDATE_LIMIT : limit);

    const ranked: { row: TSearchRow; score: number | undefined }[] = trimmedQuery
      ? rows
          .map((row) => ({
            row,
            score: scoreExhibitMatch(trimmedQuery, [
              { text: row.title, isPrimary: true },
              ...(row.body ? [{ text: row.body, isPrimary: false }] : []),
            ]),
          }))
          .sort((a, b) => b.score - a.score)
      : rows.map((row) => ({ row, score: undefined }));

    return ranked.slice(0, limit).map(({ row, score }) => ({
      id: toExhibitId(row.id),
      type: config.type,
      name: row.title,
      url: config.urlFor(row.id),
      ...(score !== undefined ? { score } : {}),
    }));
  }

  async function resolve(ids: string[]): Promise<ExhibitResolveResult[]> {
    const idToRowId = new Map<string, number>();
    for (const id of ids) {
      const rowId = parseId(id);
      if (rowId !== null) idToRowId.set(id, rowId);
    }

    const rowIds = [...idToRowId.values()];
    const rows = rowIds.length > 0 ? config.resolveRows(rowIds) : [];
    const byRowId = new Map(rows.map((row) => [row.id, row]));

    return ids.map((id): ExhibitResolveResult => {
      const rowId = idToRowId.get(id);
      const row = rowId !== undefined ? byRowId.get(rowId) : undefined;
      if (!row) return { id, deleted: true };
      return { id, name: row.title, url: config.urlFor(row.id) };
    });
  }

  // Given this Chamber's own raw row id (e.g. what create_x/get_x's own MCP
  // tool already returns), builds the Exhibit id + name/url a caller needs to
  // construct a chip token - without this, only a caller who already knows
  // the idPrefix convention could turn a raw id into a valid `[[exhibit:...]]`
  // reference. Same not-found shape as resolve() for a single id.
  async function chip(rawId: number): Promise<ChipResult> {
    const id = toExhibitId(rawId);
    const row = config.resolveRows([rawId]).find((r) => r.id === rawId);
    if (!row) return { id, deleted: true };
    return { id, name: row.title, url: config.urlFor(rawId) };
  }

  return { toExhibitId, parseId, search, resolve, chip };
}
