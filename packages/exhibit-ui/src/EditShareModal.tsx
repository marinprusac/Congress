import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ShareSummary, SharePermission, UpdateShareRequest } from "@congress/shared-types";
import { ShareFieldsEditor } from "./ShareFieldsEditor.js";
import { exhibitSharingQueryKey } from "./useExhibitSharing.js";

interface EditShareModalProps {
  exhibitId: string;
  token: string;
  onClose: () => void;
}

function exhibitSharesQueryKey(exhibitId: string) {
  return ["exhibit-shares", exhibitId] as const;
}

async function fetchSharesForExhibit(exhibitId: string): Promise<ShareSummary[]> {
  const res = await fetch(`/capitol/exhibits/${encodeURIComponent(exhibitId)}/shares`);
  if (!res.ok) throw new Error(`Failed to fetch shares: ${res.status}`);
  const data = (await res.json()) as { shares: ShareSummary[] };
  return data.shares;
}

async function patchUpdateShare(token: string, input: UpdateShareRequest): Promise<ShareSummary> {
  const res = await fetch(`/capitol/shares/${encodeURIComponent(token)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Failed to update share: ${res.status}`);
  return res.json();
}

// Lets the owner edit an existing share's terms from wherever its badge
// appears (see ExhibitSharingBadge) - the badge only carries a token, so
// the full ShareSummary (maxDepth/expiresAt/rootId/rootChamber) needed to
// prefill ShareFieldsEditor is fetched here, scoped to this exhibit.
//
// Reuses ShareControl's own .share-control-popover anchored-dropdown look
// (its parent renders the .share-control positioning context) rather than
// a fixed-backdrop dialog, so editing a share reads the same as creating
// one instead of a heavier, unrelated interaction.
export function EditShareModal({ exhibitId, token, onClose }: EditShareModalProps) {
  const queryClient = useQueryClient();
  const { data: shares, isLoading } = useQuery({
    queryKey: exhibitSharesQueryKey(exhibitId),
    queryFn: () => fetchSharesForExhibit(exhibitId),
  });
  const share = shares?.find((s) => s.token === token) ?? null;

  const [permission, setPermission] = useState<SharePermission>("view");
  const [label, setLabel] = useState("");
  const [depthEnabled, setDepthEnabled] = useState(false);
  const [maxDepth, setMaxDepth] = useState(2);
  const [expiryEnabled, setExpiryEnabled] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!share || seeded) return;
    setPermission(share.permission);
    setLabel(share.label);
    setDepthEnabled(share.maxDepth > 0);
    setMaxDepth(share.maxDepth > 0 ? share.maxDepth : 2);
    setExpiryEnabled(share.expiresAt != null);
    setExpiresAt(share.expiresAt ? share.expiresAt.slice(0, 10) : "");
    setSeeded(true);
  }, [share, seeded]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await patchUpdateShare(token, {
        permission,
        maxDepth: depthEnabled ? maxDepth : 0,
        label: label.trim(),
        expiresAt: expiryEnabled && expiresAt ? new Date(expiresAt).toISOString() : null,
      });
      queryClient.invalidateQueries({ queryKey: exhibitSharingQueryKey(exhibitId) });
      queryClient.invalidateQueries({ queryKey: exhibitSharesQueryKey(exhibitId) });
      onClose();
    } catch {
      setError("Failed to update share.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="share-control-popover">
      <div className="share-edit-header">
        <span className="share-field-label">Edit share</span>
        <button type="button" className="share-picker-clear" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      {isLoading && <p className="font-mono text-sm">Loading —</p>}
      {!isLoading && !share && <p className="share-error">Share not found.</p>}

      {share && (
        <form onSubmit={handleSubmit} className="share-form">
          <ShareFieldsEditor
            permission={permission}
            onPermissionChange={setPermission}
            label={label}
            onLabelChange={setLabel}
            depthEnabled={depthEnabled}
            onDepthEnabledChange={setDepthEnabled}
            maxDepth={maxDepth}
            onMaxDepthChange={setMaxDepth}
            expiryEnabled={expiryEnabled}
            onExpiryEnabledChange={setExpiryEnabled}
            expiresAt={expiresAt}
            onExpiresAtChange={setExpiresAt}
          />

          {error && <p className="share-error">{error}</p>}

          <button type="submit" className="share-submit" disabled={pending}>
            {pending ? "Saving —" : "Save changes"}
          </button>
        </form>
      )}
    </div>
  );
}
