import { useQuery } from "@tanstack/react-query";
import type { ExhibitRefEntry } from "@congress/shared-types";

async function fetchExhibitConnections(exhibitId: string): Promise<ExhibitRefEntry[]> {
  const res = await fetch(`/congress/exhibits/${encodeURIComponent(exhibitId)}/connections`);
  if (!res.ok) return [];
  const data = (await res.json()) as { connections: ExhibitRefEntry[] };
  return data.connections;
}

// `exhibitId: null` means "not created yet" (a draft in ExhibitLinksLayout) -
// skips the fetch entirely rather than querying a nonexistent id.
export function useExhibitConnections(exhibitId: string | null): ExhibitRefEntry[] {
  const query = useQuery({
    queryKey: ["exhibit-connections", exhibitId],
    queryFn: () => fetchExhibitConnections(exhibitId as string),
    enabled: exhibitId !== null,
  });
  return query.data ?? [];
}
