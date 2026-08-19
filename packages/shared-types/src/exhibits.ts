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
  // Connections-panel "+") rather than parsed out of body text - Capitol
  // records this per exhibit_refs row so a connection entry can report
  // whether it's safe to remove, without every caller having to ask the
  // owning Chamber.
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

// One entry in an Exhibit's undirected Connections list, same three states
// as capitolExhibitResolveResultSchema plus whether the connection is
// removable from the Connections panel (added manually) or only ever
// re-derivable by re-parsing body text. There is no direction here - a
// connection between two Exhibits is a single fact, not "this one's
// incoming" vs. "this one's outgoing".
export const exhibitRefEntrySchema = z.union([
  z.object({ id: z.string(), chamber: z.string(), name: z.string(), url: z.string(), isManual: z.boolean() }),
  z.object({ id: z.string(), chamber: z.string(), deleted: z.literal(true), isManual: z.boolean() }),
  z.object({ id: z.string(), chamber: z.string(), unavailable: z.literal(true), isManual: z.boolean() }),
]);
export type ExhibitRefEntry = z.infer<typeof exhibitRefEntrySchema>;

// A source Exhibit's explicit connections, added from a side panel rather
// than embedded in body text (e.g. "[[" wikilinks) - merged with any
// text-derived refs by the owning Chamber before it pushes outgoingRefs to
// Capitol, so they show up in the same undirected Connections graph.
// Mounted generically at "/api/exhibits/:id/refs" by every Chamber that
// opts in (see chamber-kit's mountManualRefsRoutes) - which is what lets
// Capitol proxy an add/remove to whichever Chamber actually owns the
// relevant id (see POST/DELETE /congress/exhibits/:id/connections in
// services/congress/src/server.ts).
export const manualRefRequestSchema = z.object({
  targetExhibitId: z.string().min(1),
  // Optional hint the frontend already has whenever the target came from a
  // search result (CapitolExhibitSearchResult always carries `chamber`) -
  // lets Capitol's proxy eagerly resolveOneLive() the target so it gets an
  // exhibit_cache row immediately. Without this, an exhibit that's never
  // been created/edited within Congress (a pre-existing Google Calendar
  // event is the common case) has no cache row yet, and getConnections
  // silently skips any connection whose other side isn't cached - it would
  // save successfully but never appear in the panel. A Chamber's own
  // "/api/exhibits/:id/refs" ignores this field; it's read only by
  // Capitol's proxy.
  targetChamber: z.string().optional(),
});
export type ManualRefRequest = z.infer<typeof manualRefRequestSchema>;

export const manualRefsResponseSchema = z.object({
  refs: z.array(z.string()),
});
export type ManualRefsResponse = z.infer<typeof manualRefsResponseSchema>;
