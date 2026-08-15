import { useQuery } from "@tanstack/react-query";
import type { ExhibitSharingEntry } from "@congress/shared-types";

async function fetchExhibitSharing(exhibitId: string): Promise<ExhibitSharingEntry[]> {
  const res = await fetch(`/capitol/exhibits/${encodeURIComponent(exhibitId)}/sharing`);
  if (!res.ok) return [];
  const data = (await res.json()) as { shares: ExhibitSharingEntry[] };
  return data.shares;
}

// Exported so ShareControl can invalidate exactly this query after a
// create/update/revoke, making the badge on the same page update
// immediately - both share the same QueryClient instance the host app
// already provides.
export function exhibitSharingQueryKey(exhibitId: string) {
  return ["exhibit-sharing", exhibitId] as const;
}

// Drives the "Shared" / "Shared (inherited)" badge on a Chamber's own view
// pages - the owner-facing counterpart to a share recipient's token-scoped
// view.
export function useExhibitSharing(exhibitId: string): { entries: ExhibitSharingEntry[]; loading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: exhibitSharingQueryKey(exhibitId),
    queryFn: () => fetchExhibitSharing(exhibitId),
  });

  return { entries: data ?? [], loading: isLoading };
}
