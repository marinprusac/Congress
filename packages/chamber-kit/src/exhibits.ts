import type {
  ExhibitSearchResult,
  ExhibitResolveResult,
  ExhibitSyncRequest,
  SharedExhibitContent,
  UpdateSharedExhibitContentRequest,
} from "@congress/shared-types";

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

// The generic content contract behind Exhibit Sharing - a share recipient
// only ever knows an exhibit id, never that it's specifically a "note" or a
// "document", so every chamber maps its own detail shape into the same
// canonical envelope. This factory covers the shape shared by any Chamber
// whose exhibits are rows in one local table with an integer id and a
// title (notes, documents) - a Chamber whose exhibits come from elsewhere
// (e.g. calendar's events, fetched live from Google) doesn't fit this and
// implements the search/resolve/content contract directly instead.
//
// TSearchRow/TContentRow are separate type params because a Chamber's raw DB
// row (used for search/resolve) and its domain "detail" type (returned by
// get/update, e.g. NoteDetail) commonly differ - notes.body (the DB column)
// vs. NoteDetail.content (the parsed field), for instance.
export interface TableBackedExhibitsConfig<
  TSearchRow extends { id: number; title: string },
  TContentRow,
> {
  idPrefix: string;
  type: string;
  urlFor: (id: number) => string;
  // Raw row queries - kept as passthrough callbacks so this factory never
  // has to genericize over Drizzle's own table/column types.
  searchRows: (pattern: string, limit: number) => TSearchRow[];
  resolveRows: (ids: number[]) => TSearchRow[];
  get: (id: number) => Promise<TContentRow | null>;
  update: (id: number, input: UpdateSharedExhibitContentRequest) => Promise<TContentRow | null>;
  toContent: (exhibitId: string, row: TContentRow) => SharedExhibitContent;
}

export function createTableBackedExhibits<
  TSearchRow extends { id: number; title: string },
  TContentRow,
>(config: TableBackedExhibitsConfig<TSearchRow, TContentRow>) {
  const { toExhibitId, parseId } = createExhibitIdCodec(config.idPrefix);

  // An empty query matches everything ("%%"), which combined with the
  // most-recent-first ordering chambers use in searchRows is exactly the
  // "show me what's there" listing the picker wants before the user has
  // typed anything.
  async function search(query: string, limit = 10): Promise<ExhibitSearchResult[]> {
    const pattern = `%${query}%`;
    const rows = config.searchRows(pattern, limit);
    return rows.map((row) => ({
      id: toExhibitId(row.id),
      type: config.type,
      name: row.title,
      url: config.urlFor(row.id),
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

  async function getContent(id: string): Promise<SharedExhibitContent | null> {
    const rowId = parseId(id);
    if (rowId === null) return null;
    const row = await config.get(rowId);
    if (!row) return null;
    return config.toContent(id, row);
  }

  async function updateContent(
    id: string,
    input: UpdateSharedExhibitContentRequest
  ): Promise<SharedExhibitContent | null> {
    const rowId = parseId(id);
    if (rowId === null) return null;
    const updated = await config.update(rowId, input);
    if (!updated) return null;
    return config.toContent(id, updated);
  }

  return { toExhibitId, parseId, search, resolve, getContent, updateContent };
}
