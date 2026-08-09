import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ShareSummary, UpdateShareRequest } from "@congress/shared-types";
import { exhibitSharingQueryKey } from "./useExhibitSharing.js";

async function fetchSharesForExhibit(exhibitId: string): Promise<ShareSummary[]> {
  const res = await fetch(`/capitol/exhibits/${encodeURIComponent(exhibitId)}/shares`);
  if (!res.ok) return [];
  const data = (await res.json()) as { shares: ShareSummary[] };
  return data.shares;
}

async function patchShare(token: string, input: UpdateShareRequest): Promise<ShareSummary> {
  const res = await fetch(`/capitol/shares/${encodeURIComponent(token)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Failed to update share: ${res.status}`);
  return res.json();
}

async function deleteShare(token: string): Promise<void> {
  const res = await fetch(`/capitol/shares/${encodeURIComponent(token)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to revoke share: ${res.status}`);
}

function exhibitSharesQueryKey(exhibitId: string) {
  return ["exhibit-shares", exhibitId] as const;
}

// The shares an exhibit's own "Share" button manages: creation, edit,
// revoke, all scoped to shares rooted exactly at this exhibit. Every
// mutation invalidates both this list and the exhibit-sharing badge query,
// so the "Shared" indicator on the page updates immediately rather than
// waiting for an unrelated refetch.
export function useExhibitShares(exhibitId: string) {
  const queryClient = useQueryClient();

  const sharesQuery = useQuery({
    queryKey: exhibitSharesQueryKey(exhibitId),
    queryFn: () => fetchSharesForExhibit(exhibitId),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: exhibitSharesQueryKey(exhibitId) });
    queryClient.invalidateQueries({ queryKey: exhibitSharingQueryKey(exhibitId) });
  }

  const updateMutation = useMutation({
    mutationFn: ({ token, input }: { token: string; input: UpdateShareRequest }) => patchShare(token, input),
    onSuccess: invalidate,
  });

  const revokeMutation = useMutation({
    mutationFn: (token: string) => deleteShare(token),
    onSuccess: invalidate,
  });

  return {
    shares: sharesQuery.data ?? [],
    loading: sharesQuery.isLoading,
    update: updateMutation.mutateAsync,
    updating: updateMutation.isPending,
    revoke: revokeMutation.mutateAsync,
    revoking: revokeMutation.isPending,
    invalidate,
  };
}
