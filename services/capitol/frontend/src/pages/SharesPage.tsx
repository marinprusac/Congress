import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreateShareForm } from "@congress/exhibit-ui";
import { fetchShares, revokeShare } from "@/lib/api";
import { CapitolHeader } from "@/components/CapitolHeader";

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toISOString().replace("T", " ").slice(0, 16);
}

function SharesList() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ["capitol", "shares"], queryFn: fetchShares });

  const revokeMutation = useMutation({
    mutationFn: (token: string) => revokeShare(token),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["capitol", "shares"] }),
  });

  if (isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (isError) return <p className="font-mono text-sm text-alert">Failed to load shares.</p>;
  if (!data || data.length === 0) return <p className="font-mono text-sm text-dust">— No shares yet —</p>;

  return (
    <div className="border-t border-dust">
      {data.map((share) => {
        const revoked = Boolean(share.revokedAt);
        const expired = share.expiresAt ? new Date(share.expiresAt).getTime() <= Date.now() : false;
        const inactive = revoked || expired;
        return (
          <div key={share.token} className={`border-b border-dust px-1 py-3 ${inactive ? "opacity-50" : ""}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-display text-lg text-ink">{share.label || "(untitled share)"}</p>
                <p className="font-mono text-xs text-slate">
                  {share.rootChamber} — {share.rootId} · {share.permission} · depth {share.maxDepth}
                </p>
                <p className="font-mono text-xs text-dust">
                  Created {formatTimestamp(share.createdAt)} · Last accessed {formatTimestamp(share.lastAccessedAt)}
                  {revoked && " · Revoked"}
                  {expired && !revoked && " · Expired"}
                </p>
              </div>
              <div className="flex shrink-0 gap-3 font-mono text-xs uppercase tracking-wide">
                {!inactive && (
                  <a href={`/shared/${share.token}`} className="text-accent hover:underline">
                    Open
                  </a>
                )}
                {!revoked && (
                  <button
                    onClick={() => {
                      if (confirm("Revoke this share? This cannot be undone.")) revokeMutation.mutate(share.token);
                    }}
                    className="text-alert hover:underline"
                  >
                    Revoke
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function SharesPage() {
  const queryClient = useQueryClient();

  return (
    <div className="min-h-screen bg-parchment text-ink">
      <CapitolHeader />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h2 className="mb-6 font-display text-2xl text-ink">Shares</h2>
        <div className="mb-10 border border-dust p-4">
          <CreateShareForm
            className="share-form"
            onCreated={() => queryClient.invalidateQueries({ queryKey: ["capitol", "shares"] })}
          />
        </div>
        <SharesList />
      </main>
    </div>
  );
}
