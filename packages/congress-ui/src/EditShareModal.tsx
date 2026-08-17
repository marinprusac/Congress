import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ShareSummary, SharePermission, UpdateShareRequest } from "@congress/shared-types";
import { ShareFieldsEditor } from "./ShareFieldsEditor.js";
import { CopyLinkButton } from "./CopyLinkButton.js";
import { ConfirmSheet } from "./ConfirmSheet.js";
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
  const res = await fetch(`/congress/exhibits/${encodeURIComponent(exhibitId)}/shares`);
  if (!res.ok) throw new Error(`Failed to fetch shares: ${res.status}`);
  const data = (await res.json()) as { shares: ShareSummary[] };
  return data.shares;
}

async function patchUpdateShare(token: string, input: UpdateShareRequest): Promise<ShareSummary> {
  const res = await fetch(`/congress/shares/${encodeURIComponent(token)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Failed to update share: ${res.status}`);
  return res.json();
}

async function deleteShare(token: string): Promise<void> {
  const res = await fetch(`/congress/shares/${encodeURIComponent(token)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to revoke share: ${res.status}`);
}

// Lets the owner edit an existing share's terms from wherever its badge
// appears (see ExhibitSharingBadge) - the badge only carries a token, so
// the full ShareSummary (maxDepth/expiresAt/rootId/rootChamber) needed to
// prefill ShareFieldsEditor is fetched here, scoped to this exhibit.
//
// Rendered inside the same SharePopover ShareControl uses, so editing a
// share reads and dismisses exactly the same way as creating one - no
// title bar or close button of its own, just the form.
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
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

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

  function invalidateShareQueries() {
    queryClient.invalidateQueries({ queryKey: exhibitSharingQueryKey(exhibitId) });
    queryClient.invalidateQueries({ queryKey: exhibitSharesQueryKey(exhibitId) });
    queryClient.invalidateQueries({ queryKey: ["capitol", "shares"] });
  }

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
      invalidateShareQueries();
      onClose();
    } catch {
      setError("Failed to update share.");
    } finally {
      setPending(false);
    }
  }

  async function handleRevoke() {
    if (revoking) return;
    setConfirmingRevoke(false);
    setRevoking(true);
    setError(null);
    try {
      await deleteShare(token);
      invalidateShareQueries();
      onClose();
    } catch {
      setError("Failed to revoke share.");
      setRevoking(false);
    }
  }

  const link = `${window.location.origin}/shared/${token}`;

  return (
    <>
      {isLoading && <p className="font-mono text-sm">Loading —</p>}
      {!isLoading && !share && <p className="share-error">Share not found.</p>}

      {share && (
        <form onSubmit={handleSubmit} className="share-form">
          <div className="share-field">
            <span className="share-field-label">Share link</span>
            <div className="share-row-link">
              <a href={link} className="share-result-link">
                {link}
              </a>
              <CopyLinkButton link={link} />
            </div>
          </div>

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

          <div className="share-edit-actions">
            <button type="submit" className="share-submit" disabled={pending || revoking}>
              {pending ? "Saving —" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingRevoke(true)}
              disabled={pending || revoking}
              className="share-revoke"
            >
              {revoking ? "Revoking —" : "Revoke"}
            </button>
          </div>
        </form>
      )}
      <ConfirmSheet
        open={confirmingRevoke}
        title="Revoke share"
        message="Revoke this share? This cannot be undone."
        confirmLabel="Revoke"
        onConfirm={handleRevoke}
        onCancel={() => setConfirmingRevoke(false)}
      />
    </>
  );
}
