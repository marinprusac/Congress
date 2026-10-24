import { useQuery } from "@tanstack/react-query";
import type { RecordRefEntry } from "@congress/shared-types";

async function fetchRecordConnections(recordId: string): Promise<RecordRefEntry[]> {
  const res = await fetch(`/congress/refs/${encodeURIComponent(recordId)}/connections`);
  if (!res.ok) return [];
  const data = (await res.json()) as { connections: RecordRefEntry[] };
  return data.connections;
}

// `recordId: null` means "not created yet" (a draft in RecordLinksLayout) -
// skips the fetch entirely rather than querying a nonexistent id.
export function useRecordConnections(recordId: string | null): RecordRefEntry[] {
  const query = useQuery({
    queryKey: ["record-connections", recordId],
    queryFn: () => fetchRecordConnections(recordId as string),
    enabled: recordId !== null,
  });
  return query.data ?? [];
}
