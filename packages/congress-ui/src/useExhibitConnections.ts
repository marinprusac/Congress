import { useQuery } from "@tanstack/react-query";
import type { ExhibitRefEntry } from "@congress/shared-types";

async function fetchExhibitConnections(exhibitId: string): Promise<ExhibitRefEntry[]> {
  const res = await fetch(`/congress/exhibits/${encodeURIComponent(exhibitId)}/connections`);
  if (!res.ok) return [];
  const data = (await res.json()) as { connections: ExhibitRefEntry[] };
  return data.connections;
}

export function useExhibitConnections(exhibitId: string): ExhibitRefEntry[] {
  const query = useQuery({
    queryKey: ["exhibit-connections", exhibitId],
    queryFn: () => fetchExhibitConnections(exhibitId),
  });
  return query.data ?? [];
}
