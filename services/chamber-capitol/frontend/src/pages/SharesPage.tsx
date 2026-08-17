import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreateShareForm, ConfirmSheet, formatTimestamp, showToast } from "@congress/congress-ui";
import { fetchShares, revokeShare } from "@/lib/api";

function isActive(share: { revokedAt: string | null; expiresAt: string | null }): boolean {
  if (share.revokedAt) return false;
  if (share.expiresAt && new Date(share.expiresAt).getTime() <= Date.now()) return false;
  return true;
}

function SharesList() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ["capitol", "shares"], queryFn: fetchShares });
  const [confirmingToken, setConfirmingToken] = useState<string | null>(null);

  const revokeMutation = useMutation({
    mutationFn: (token: string) => revokeShare(token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["capitol", "shares"] });
      showToast("Share revoked");
    },
    onError: () => showToast("Failed to revoke share.", "error"),
  });

  if (isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (isError) return <p className="font-mono text-sm text-alert">Failed to load shares.</p>;

  // Revoked/expired shares no longer grant access to anything, so there's no
  // reason to keep showing them here - they'd only accumulate and clutter
  // the list over time.
  const active = data?.filter(isActive) ?? [];
  if (active.length === 0) return <p className="font-mono text-sm text-dust">— No shares yet —</p>;

  return (
    <div className="border-t border-dust">
      {active.map((share) => (
        <div key={share.token} className="border-b border-dust px-1 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-display text-lg text-ink">{share.label || "(untitled share)"}</p>
              <p className="font-mono text-xs text-slate">
                {share.rootChamber} — {share.rootId} · {share.permission} · depth {share.maxDepth}
              </p>
              <p className="font-mono text-xs text-dust">
                Created {formatTimestamp(share.createdAt)} · Last accessed {formatTimestamp(share.lastAccessedAt)}
              </p>
            </div>
            <div className="flex shrink-0 gap-5 font-mono text-xs uppercase tracking-wide">
              <a href={`/shared/${share.token}`} className="tap-target text-accent hover:underline">
                Open
              </a>
              <button
                onClick={() => setConfirmingToken(share.token)}
                className="tap-target text-alert hover:underline"
              >
                Revoke
              </button>
            </div>
          </div>
        </div>
      ))}
      <ConfirmSheet
        open={confirmingToken !== null}
        title="Revoke share"
        message="Revoke this share? This cannot be undone."
        confirmLabel="Revoke"
        onConfirm={() => {
          if (confirmingToken) revokeMutation.mutate(confirmingToken);
          setConfirmingToken(null);
        }}
        onCancel={() => setConfirmingToken(null)}
      />
    </div>
  );
}

export function SharesPage() {
  const queryClient = useQueryClient();

  return (
    <section>
      <h2 className="mb-6 font-display text-2xl text-ink">Shares</h2>
      <div className="mb-10 border border-dust p-4">
        <CreateShareForm
          className="share-form"
          onCreated={() => queryClient.invalidateQueries({ queryKey: ["capitol", "shares"] })}
        />
      </div>
      <SharesList />
    </section>
  );
}
