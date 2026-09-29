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
