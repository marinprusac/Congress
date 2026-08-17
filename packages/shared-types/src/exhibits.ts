import { z } from "zod";

// Base shape returned by a Chamber's own GET /exhibits/search.
export const exhibitSearchResultSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  url: z.string(),
});
export type ExhibitSearchResult = z.infer<typeof exhibitSearchResultSchema>;

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

// Pushed by a Chamber to Capitol on Exhibit create/update/delete.
export const exhibitSyncRequestSchema = z.object({
  chamber: z.string().min(1),
  id: z.string().min(1),
  type: z.string().min(1),
  name: z.string(),
  url: z.string(),
  deleted: z.boolean().optional(),
  outgoingRefs: z.array(z.string()),
  // The subset of outgoingRefs that were added explicitly (via a
  // References-panel "+") rather than parsed out of body text - Capitol
  // records this per exhibit_refs row so a backlinks/frontlinks entry can
  // report whether it's safe to remove from either side, without every
  // caller having to ask the owning Chamber.
  manualRefs: z.array(z.string()).optional(),
});
export type ExhibitSyncRequest = z.infer<typeof exhibitSyncRequestSchema>;

// Capitol's cross-chamber search aggregation attaches `chamber` at merge time.
export const capitolExhibitSearchResultSchema = exhibitSearchResultSchema.extend({
  chamber: z.string(),
});
export type CapitolExhibitSearchResult = z.infer<typeof capitolExhibitSearchResultSchema>;

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

// A backlinks/frontlinks entry, same three states as
// capitolExhibitResolveResultSchema plus whether the underlying ref is
// removable from a References panel (added manually) or only ever
// derived from body text.
export const exhibitRefEntrySchema = z.union([
  z.object({ id: z.string(), chamber: z.string(), name: z.string(), url: z.string(), isManual: z.boolean() }),
  z.object({ id: z.string(), chamber: z.string(), deleted: z.literal(true), isManual: z.boolean() }),
  z.object({ id: z.string(), chamber: z.string(), unavailable: z.literal(true), isManual: z.boolean() }),
]);
export type ExhibitRefEntry = z.infer<typeof exhibitRefEntrySchema>;

// A source Exhibit's explicit references, added from a side panel rather
// than embedded in body text (e.g. "[[" wikilinks) - merged with any
// text-derived refs by the owning Chamber before it pushes outgoingRefs to
// Capitol, so they show up in the same frontlinks/backlinks graph. Mounted
// generically at "/api/exhibits/:id/refs" by every Chamber that opts in
// (see chamber-kit's mountManualRefsRoutes), the same convention
// mountExhibitContentRoutes uses - which is what lets Capitol proxy an add/
// remove to whichever Chamber actually owns the target id, regardless of
// which Chamber's page the request originated from (see
// POST/DELETE /capitol/exhibits/:id/refs in services/congress/src/server.ts).
export const manualRefRequestSchema = z.object({
  targetExhibitId: z.string().min(1),
  // Optional hint the frontend already has whenever the target came from a
  // search result (CapitolExhibitSearchResult always carries `chamber`) -
  // lets Capitol's proxy eagerly resolveOneLive() the target so it gets an
  // exhibit_cache row immediately. Without this, an exhibit that's never
  // been created/edited within Congress (a pre-existing Google Calendar
  // event is the common case) has no cache row yet, and
  // getFrontlinks/getBacklinks silently skip any ref whose target isn't
  // cached - the reference would save successfully but never appear
  // anywhere in either panel. A Chamber's own "/api/exhibits/:id/refs"
  // ignores this field; it's read only by Capitol's proxy.
  targetChamber: z.string().optional(),
});
export type ManualRefRequest = z.infer<typeof manualRefRequestSchema>;

export const manualRefsResponseSchema = z.object({
  refs: z.array(z.string()),
});
export type ManualRefsResponse = z.infer<typeof manualRefsResponseSchema>;
