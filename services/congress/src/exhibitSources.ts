import type { ExhibitResolveResult, ExhibitSearchResult, FeedCandidate } from "@congress/shared-types";

// An exhibit namespace served in-process by Congress itself (the type
// engine's "e"), next to the Chambers reached over chamberFetch.

export interface LocalExhibitSource {
  namespace: string;
  search(query: string): ExhibitSearchResult[];
  resolve(ids: string[]): ExhibitResolveResult[];
  typeOf(id: string): string | null;
  chip(id: string): { id: string; name: string; url: string } | null;
  addManualRef(id: string, targetExhibitId: string): string[] | null;
  removeManualRef(id: string, targetExhibitId: string): string[] | null;
  feedCandidates(now: Date): FeedCandidate[];
  // Old exhibit ids this namespace replaced (e.g. notes' note-42): legacy id
  // -> id here, and the reverse.
  canonicalize?(ids: string[]): Map<string, string>;
  legacyIdsOf?(id: string): string[];
}

const sources = new Map<string, LocalExhibitSource>();

export function registerLocalSource(source: LocalExhibitSource): void {
  sources.set(source.namespace, source);
}

export function getLocalSource(namespace: string): LocalExhibitSource | undefined {
  return sources.get(namespace);
}

export function listLocalSources(): LocalExhibitSource[] {
  return [...sources.values()];
}

// Legacy id -> current id, across every local namespace.
export function canonicalIds(ids: string[]): Map<string, { id: string; namespace: string }> {
  const out = new Map<string, { id: string; namespace: string }>();
  if (ids.length === 0) return out;
  for (const source of sources.values()) {
    for (const [legacy, id] of source.canonicalize?.(ids) ?? []) out.set(legacy, { id, namespace: source.namespace });
  }
  return out;
}

export function canonicalId(id: string): string {
  return canonicalIds([id]).get(id)?.id ?? id;
}

export function legacyIdsOf(id: string): string[] {
  return [...sources.values()].flatMap((s) => s.legacyIdsOf?.(id) ?? []);
}
