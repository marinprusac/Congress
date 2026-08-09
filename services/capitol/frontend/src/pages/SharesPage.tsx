import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useExhibitSearch } from "@congress/exhibit-ui";
import type { CapitolExhibitSearchResult, SharePermission } from "@congress/shared-types";
import { fetchShares, createShare, revokeShare } from "@/lib/api";
import { CapitolHeader } from "@/components/CapitolHeader";

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toISOString().replace("T", " ").slice(0, 16);
}

function RootExhibitPicker({
  selected,
  onChange,
}: {
  selected: CapitolExhibitSearchResult | null;
  onChange: (result: CapitolExhibitSearchResult | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const { results, loading } = useExhibitSearch(query, open);

  if (selected) {
    return (
      <div className="flex items-center justify-between border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink">
        <span>
          <span className="text-xs uppercase text-dust">{selected.chamber}</span> — {selected.name}
        </span>
        <button type="button" onClick={() => onChange(null)} className="text-dust hover:text-alert">
          ×
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search for an exhibit to share —"
        className="w-full border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
      />
      {open && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto border border-dust bg-parchment">
          {loading && <li className="px-3 py-2 font-mono text-xs text-dust">Searching —</li>}
          {!loading && results.length === 0 && (
            <li className="px-3 py-2 font-mono text-xs text-dust">No matches</li>
          )}
          {results.map((r) => (
            <li key={`${r.chamber}:${r.id}`}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(r);
                  setQuery("");
                  setOpen(false);
                }}
                className="block w-full px-3 py-2 text-left font-mono text-sm text-ink hover:bg-ink/[0.05]"
              >
                <span className="text-xs uppercase text-dust">{r.chamber}</span> — {r.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CreateShareForm() {
  const queryClient = useQueryClient();
  const [root, setRoot] = useState<CapitolExhibitSearchResult | null>(null);
  const [permission, setPermission] = useState<SharePermission>("view");
  const [maxDepth, setMaxDepth] = useState(2);
  const [label, setLabel] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [createdLink, setCreatedLink] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      createShare({
        rootChamber: root!.chamber,
        rootId: root!.id,
        maxDepth,
        permission,
        label: label.trim() || undefined,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      }),
    onSuccess: (share) => {
      queryClient.invalidateQueries({ queryKey: ["capitol", "shares"] });
      setCreatedLink(`${window.location.origin}/shared/${share.token}`);
      setRoot(null);
      setLabel("");
      setExpiresAt("");
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (root) mutation.mutate();
      }}
      className="mb-10 space-y-4 border border-dust p-4"
    >
      <div>
        <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">Exhibit to share</label>
        <RootExhibitPicker selected={root} onChange={setRoot} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">Permission</label>
          <select
            value={permission}
            onChange={(e) => setPermission(e.target.value as SharePermission)}
            className="w-full border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          >
            <option value="view">View</option>
            <option value="edit">Edit</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">
            Max depth ({maxDepth === 0 ? "root only" : `${maxDepth} hop${maxDepth === 1 ? "" : "s"}`})
          </label>
          <input
            type="number"
            min={0}
            max={10}
            value={maxDepth}
            onChange={(e) => setMaxDepth(Number(e.target.value))}
            className="w-full border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">Label (optional)</label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. for Claude — architecture"
          className="w-full border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />
      </div>

      <div>
        <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">Expires (optional)</label>
        <input
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          className="w-full border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />
      </div>

      {mutation.isError && <p className="font-mono text-sm text-alert">Failed to create share.</p>}

      <button
        type="submit"
        disabled={!root || mutation.isPending}
        className="border border-accent px-4 py-2 font-mono text-xs uppercase tracking-wide text-accent hover:bg-accent hover:text-parchment disabled:opacity-50"
      >
        {mutation.isPending ? "Creating —" : "Create share"}
      </button>

      {createdLink && (
        <div className="border border-accent bg-accent/5 p-3 font-mono text-sm text-ink">
          <p className="mb-1 text-xs uppercase tracking-wide text-dust">Share link</p>
          <a href={createdLink} className="break-all text-accent hover:underline">
            {createdLink}
          </a>
        </div>
      )}
    </form>
  );
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
  return (
    <div className="min-h-screen bg-parchment text-ink">
      <CapitolHeader />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h2 className="mb-6 font-display text-2xl text-ink">Shares</h2>
        <CreateShareForm />
        <SharesList />
      </main>
    </div>
  );
}
