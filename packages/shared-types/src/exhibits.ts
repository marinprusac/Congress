import { z } from "zod";

// Base shape returned by a Chamber's own GET /exhibits/search.
export const exhibitSearchResultSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  url: z.string(),
});
export type ExhibitSearchResult = z.infer<typeof exhibitSearchResultSchema>;

export const exhibitSearchResponseSchema = z.object({
  results: z.array(exhibitSearchResultSchema),
});
export type ExhibitSearchResponse = z.infer<typeof exhibitSearchResponseSchema>;

// Request/response for a Chamber's own POST /exhibits/resolve - ids are
// assumed to already be owned by that Chamber (the caller groups by chamber
// before calling).
export const exhibitResolveRequestSchema = z.object({
  ids: z.array(z.string()),
});
export type ExhibitResolveRequest = z.infer<typeof exhibitResolveRequestSchema>;

export const exhibitResolveResultSchema = z.union([
  z.object({ id: z.string(), name: z.string(), url: z.string() }),
  z.object({ id: z.string(), deleted: z.literal(true) }),
]);
export type ExhibitResolveResult = z.infer<typeof exhibitResolveResultSchema>;

export const exhibitResolveResponseSchema = z.object({
  results: z.array(exhibitResolveResultSchema),
});
export type ExhibitResolveResponse = z.infer<typeof exhibitResolveResponseSchema>;

// Pushed by a Chamber to Capitol on Exhibit create/update/delete.
export const exhibitSyncRequestSchema = z.object({
  chamber: z.string().min(1),
  id: z.string().min(1),
  type: z.string().min(1),
  name: z.string(),
  url: z.string(),
  deleted: z.boolean().optional(),
  outgoingRefs: z.array(z.string()),
});
export type ExhibitSyncRequest = z.infer<typeof exhibitSyncRequestSchema>;

// Capitol's cross-chamber search aggregation attaches `chamber` at merge time.
export const capitolExhibitSearchResultSchema = exhibitSearchResultSchema.extend({
  chamber: z.string(),
});
export type CapitolExhibitSearchResult = z.infer<typeof capitolExhibitSearchResultSchema>;

export const capitolExhibitSearchResponseSchema = z.object({
  results: z.array(capitolExhibitSearchResultSchema),
});
export type CapitolExhibitSearchResponse = z.infer<typeof capitolExhibitSearchResponseSchema>;

// Chamber included per-ref since an id that never synced has no cache row to
// infer the owning chamber from.
export const capitolExhibitResolveRequestSchema = z.object({
  refs: z.array(z.object({ id: z.string(), chamber: z.string() })),
});
export type CapitolExhibitResolveRequest = z.infer<typeof capitolExhibitResolveRequestSchema>;

// `deleted` = the owning Chamber confirmed this id no longer exists.
// `unavailable` = the owning Chamber could not be reached at all - distinct
// states per the spec, must render differently and `unavailable` should be
// retried rather than treated as a confirmed deletion.
export const capitolExhibitResolveResultSchema = z.union([
  z.object({ id: z.string(), chamber: z.string(), name: z.string(), url: z.string() }),
  z.object({ id: z.string(), chamber: z.string(), deleted: z.literal(true) }),
  z.object({ id: z.string(), chamber: z.string(), unavailable: z.literal(true) }),
]);
export type CapitolExhibitResolveResult = z.infer<typeof capitolExhibitResolveResultSchema>;

export const capitolExhibitResolveResponseSchema = z.object({
  results: z.array(capitolExhibitResolveResultSchema),
});
export type CapitolExhibitResolveResponse = z.infer<typeof capitolExhibitResolveResponseSchema>;

export const exhibitBacklinksResponseSchema = z.object({
  backlinks: z.array(capitolExhibitResolveResultSchema),
});
export type ExhibitBacklinksResponse = z.infer<typeof exhibitBacklinksResponseSchema>;
