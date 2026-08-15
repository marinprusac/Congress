import type { SharePermission } from "@congress/shared-types";

interface ShareFieldsEditorProps {
  permission: SharePermission;
  onPermissionChange: (permission: SharePermission) => void;
  label: string;
  onLabelChange: (label: string) => void;
  depthEnabled: boolean;
  onDepthEnabledChange: (enabled: boolean) => void;
  maxDepth: number;
  onMaxDepthChange: (depth: number) => void;
  expiryEnabled: boolean;
  onExpiryEnabledChange: (enabled: boolean) => void;
  expiresAt: string;
  onExpiresAtChange: (value: string) => void;
}

// The permission/label/depth/expiry fields shared by CreateShareForm (a new
// share) and ShareControl's inline row editor (an existing one) - kept as
// one component so both stay in sync as the fields evolve.
export function ShareFieldsEditor({
  permission,
  onPermissionChange,
  label,
  onLabelChange,
  depthEnabled,
  onDepthEnabledChange,
  maxDepth,
  onMaxDepthChange,
  expiryEnabled,
  onExpiryEnabledChange,
  expiresAt,
  onExpiresAtChange,
}: ShareFieldsEditorProps) {
  return (
    <>
      <label className="share-field">
        <span className="share-field-label">Permission</span>
        <select
          className="share-select"
          value={permission}
          onChange={(e) => onPermissionChange(e.target.value as SharePermission)}
        >
          <option value="view">View</option>
          <option value="edit">Edit</option>
        </select>
      </label>

      <label className="share-field">
        <span className="share-field-label">Label (optional)</span>
        <input
          className="share-input"
          value={label}
          onChange={(e) => onLabelChange(e.target.value)}
          placeholder="e.g. for Claude — architecture"
        />
      </label>

      <label className="share-checkbox">
        <input type="checkbox" checked={depthEnabled} onChange={(e) => onDepthEnabledChange(e.target.checked)} />
        Also share referenced exhibits
      </label>
      {depthEnabled && (
        <label className="share-field share-field-nested">
          <span className="share-field-label">
            Max depth ({maxDepth} hop{maxDepth === 1 ? "" : "s"})
          </span>
          <input
            type="number"
            min={1}
            max={10}
            className="share-input"
            value={maxDepth}
            onChange={(e) => onMaxDepthChange(Number(e.target.value))}
          />
        </label>
      )}

      <label className="share-checkbox">
        <input type="checkbox" checked={expiryEnabled} onChange={(e) => onExpiryEnabledChange(e.target.checked)} />
        Set an expiration date
      </label>
      {expiryEnabled && (
        <label className="share-field share-field-nested">
          <span className="share-field-label">Expires</span>
          <input
            type="date"
            className="share-input"
            value={expiresAt}
            onChange={(e) => onExpiresAtChange(e.target.value)}
          />
        </label>
      )}
    </>
  );
}
