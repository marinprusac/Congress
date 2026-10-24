import type { RecordResolveResult, RecordSearchResult, FeedCandidate } from "@congress/shared-types";

// A record namespace served in-process by Congress itself (the type
// engine's "e"), next to the Chambers reached over chamberFetch.

export interface LocalRecordSource {
  namespace: string;
  search(query: string): RecordSearchResult[];
  resolve(ids: string[]): RecordResolveResult[];
  typeOf(id: string): string | null;
  chip(id: string): { id: string; name: string; url: string } | null;
  addManualRef(id: string, targetRecordId: string): string[] | null;
  removeManualRef(id: string, targetRecordId: string): string[] | null;
  feedCandidates(now: Date): FeedCandidate[];
  // Old record ids this namespace replaced (e.g. notes' note-42): legacy id
  // -> id here, and the reverse.
  canonicalize?(ids: string[]): Map<string, string>;
  legacyIdsOf?(id: string): string[];
}

const sources = new Map<string, LocalRecordSource>();

export function registerLocalSource(source: LocalRecordSource): void {
  sources.set(source.namespace, source);
}

export function getLocalSource(namespace: string): LocalRecordSource | undefined {
  return sources.get(namespace);
}

export function listLocalSources(): LocalRecordSource[] {
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
