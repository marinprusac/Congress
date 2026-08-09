import { useState } from "react";
import type { ShareSummary, UpdateShareRequest, SharePermission } from "@congress/shared-types";
import { CreateShareForm } from "./CreateShareForm.js";
import { ShareFieldsEditor } from "./ShareFieldsEditor.js";
import { CopyLinkButton } from "./CopyLinkButton.js";
import { useExhibitShares } from "./useExhibitShares.js";

interface ShareControlProps {
  chamber: string;
  exhibitId: string;
  exhibitName: string;
  className?: string;
}

function ShareRow({
  share,
  onUpdate,
  updating,
  onRevoke,
  revoking,
}: {
  share: ShareSummary;
  onUpdate: (args: { token: string; input: UpdateShareRequest }) => Promise<ShareSummary>;
  updating: boolean;
  onRevoke: (token: string) => Promise<void>;
  revoking: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [permission, setPermission] = useState<SharePermission>(share.permission);
  const [label, setLabel] = useState(share.label);
  const [depthEnabled, setDepthEnabled] = useState(share.maxDepth > 0);
  const [maxDepth, setMaxDepth] = useState(share.maxDepth > 0 ? share.maxDepth : 2);
  const [expiryEnabled, setExpiryEnabled] = useState(Boolean(share.expiresAt));
  const [expiresAt, setExpiresAt] = useState(share.expiresAt ? share.expiresAt.slice(0, 10) : "");
  const [error, setError] = useState<string | null>(null);

  const revoked = Boolean(share.revokedAt);
  const expired = share.expiresAt ? new Date(share.expiresAt).getTime() <= Date.now() : false;
  const inactive = revoked || expired;
  const link = `${window.location.origin}/shared/${share.token}`;

  function resetDraft() {
    setPermission(share.permission);
    setLabel(share.label);
    setDepthEnabled(share.maxDepth > 0);
    setMaxDepth(share.maxDepth > 0 ? share.maxDepth : 2);
    setExpiryEnabled(Boolean(share.expiresAt));
    setExpiresAt(share.expiresAt ? share.expiresAt.slice(0, 10) : "");
    setError(null);
  }

  async function handleSave() {
    setError(null);
    try {
      await onUpdate({
        token: share.token,
        input: {
          permission,
          maxDepth: depthEnabled ? maxDepth : 0,
          label,
          expiresAt: expiryEnabled && expiresAt ? new Date(expiresAt).toISOString() : null,
        },
      });
      setEditing(false);
    } catch {
      setError("Failed to save changes.");
    }
  }

  if (editing) {
    return (
      <div className="share-row">
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
        <div className="share-row-actions">
          <button type="button" className="share-row-action" disabled={updating} onClick={handleSave}>
            {updating ? "Saving —" : "Save"}
          </button>
          <button
            type="button"
            className="share-row-action"
            onClick={() => {
              resetDraft();
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={inactive ? "share-row share-row-inactive" : "share-row"}>
      <div className="share-row-header">
        <span className="share-row-label">{share.label || "(untitled share)"}</span>
        <span className="share-row-meta">
          {share.permission} · {share.maxDepth === 0 ? "root only" : `${share.maxDepth} hop${share.maxDepth === 1 ? "" : "s"}`}
          {revoked && " · Revoked"}
          {expired && !revoked && " · Expired"}
        </span>
      </div>
      {!inactive && (
        <>
          <div className="share-row-link">
            <a href={link} className="share-result-link">
              {link}
            </a>
            <CopyLinkButton link={link} />
          </div>
          <div className="share-row-actions">
            <button type="button" className="share-row-action" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button
              type="button"
              className="share-row-action share-row-action-danger"
              disabled={revoking}
              onClick={() => {
                if (confirm("Revoke this share? This cannot be undone.")) onRevoke(share.token);
              }}
            >
              Revoke
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// "Share" trigger + inline panel for an exhibit's own view page - the
// exhibit is already known, so the create form skips CreateShareForm's
// picker entirely (see fixedRoot). Also lists and manages any shares
// already rooted at this exhibit, so editing/revoking/finding the link for
// a share doesn't require a trip to Capitol's standalone Shares page.
export function ShareControl({ chamber, exhibitId, exhibitName, className }: ShareControlProps) {
  const [open, setOpen] = useState(false);
  const { shares, loading, update, updating, revoke, revoking, invalidate } = useExhibitShares(exhibitId);

  return (
    <div className={className ? `${className} share-control` : "share-control"}>
      <button type="button" className="share-control-trigger" onClick={() => setOpen((o) => !o)}>
        Share
      </button>
      <div className="share-control-popover" hidden={!open}>
        {!loading && shares.length > 0 && (
          <>
            <p className="share-section-heading">Shares</p>
            <div className="share-list">
              {shares.map((share) => (
                <ShareRow
                  key={share.token}
                  share={share}
                  onUpdate={update}
                  updating={updating}
                  onRevoke={revoke}
                  revoking={revoking}
                />
              ))}
            </div>
            <p className="share-section-heading">New share</p>
          </>
        )}
        <CreateShareForm
          fixedRoot={{ chamber, id: exhibitId, name: exhibitName }}
          className="share-form"
          onCreated={invalidate}
        />
      </div>
    </div>
  );
}
