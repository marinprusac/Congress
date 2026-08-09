import { useState, type FormEvent } from "react";
import type { CapitolExhibitSearchResult, ShareSummary, SharePermission } from "@congress/shared-types";
import { useExhibitSearch } from "./useExhibitSearch.js";

interface ShareRoot {
  chamber: string;
  id: string;
  name: string;
}

interface CreateShareFormProps {
  // When set, the exhibit is already known (embedded on its own view page)
  // and no picker is shown. When omitted, a search picker lets the caller
  // choose any exhibit as the root (used by Capitol's standalone Shares page).
  fixedRoot?: ShareRoot;
  onCreated?: (share: ShareSummary) => void;
  className?: string;
}

async function postCreateShare(input: {
  rootChamber: string;
  rootId: string;
  maxDepth: number;
  permission: SharePermission;
  label?: string;
  expiresAt?: string;
}): Promise<ShareSummary> {
  const res = await fetch("/capitol/shares", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Failed to create share: ${res.status}`);
  return res.json();
}

function RootPicker({
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
      <div className="share-picker-selected">
        <span>
          <span className="share-picker-chamber">{selected.chamber}</span> — {selected.name}
        </span>
        <button type="button" onClick={() => onChange(null)} className="share-picker-clear">
          ×
        </button>
      </div>
    );
  }

  return (
    <div className="share-picker">
      <input
        className="share-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search for an exhibit to share —"
      />
      {open && (
        <ul className="share-picker-list">
          {loading && <li className="share-picker-empty">Searching —</li>}
          {!loading && results.length === 0 && <li className="share-picker-empty">No matches</li>}
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
                className="share-picker-option"
              >
                <span className="share-picker-chamber">{r.chamber}</span> — {r.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Minimal by default: only permission + label are always visible. Recursion
// depth defaults to 0 (this exhibit only) and expiration is unset unless the
// corresponding checkbox is opened - both are edge-case settings that would
// otherwise clutter the common case of "share just this."
export function CreateShareForm({ fixedRoot, onCreated, className }: CreateShareFormProps) {
  const [pickedRoot, setPickedRoot] = useState<CapitolExhibitSearchResult | null>(null);
  const [permission, setPermission] = useState<SharePermission>("view");
  const [label, setLabel] = useState("");
  const [depthEnabled, setDepthEnabled] = useState(false);
  const [maxDepth, setMaxDepth] = useState(2);
  const [expiryEnabled, setExpiryEnabled] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdLink, setCreatedLink] = useState<string | null>(null);

  const effectiveRoot: ShareRoot | null =
    fixedRoot ?? (pickedRoot ? { chamber: pickedRoot.chamber, id: pickedRoot.id, name: pickedRoot.name } : null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!effectiveRoot || pending) return;
    setPending(true);
    setError(null);
    try {
      const share = await postCreateShare({
        rootChamber: effectiveRoot.chamber,
        rootId: effectiveRoot.id,
        maxDepth: depthEnabled ? maxDepth : 0,
        permission,
        label: label.trim() || undefined,
        expiresAt: expiryEnabled && expiresAt ? new Date(expiresAt).toISOString() : undefined,
      });
      setCreatedLink(`${window.location.origin}/shared/${share.token}`);
      onCreated?.(share);
      setPickedRoot(null);
      setLabel("");
      setDepthEnabled(false);
      setExpiryEnabled(false);
      setExpiresAt("");
    } catch {
      setError("Failed to create share.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={className}>
      {fixedRoot ? (
        <div className="share-field">
          <span className="share-field-label">Sharing</span>
          <div className="share-fixed-root">{fixedRoot.name}</div>
        </div>
      ) : (
        <div className="share-field">
          <span className="share-field-label">Exhibit to share</span>
          <RootPicker selected={pickedRoot} onChange={setPickedRoot} />
        </div>
      )}

      <label className="share-field">
        <span className="share-field-label">Permission</span>
        <select
          className="share-select"
          value={permission}
          onChange={(e) => setPermission(e.target.value as SharePermission)}
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
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. for Claude — architecture"
        />
      </label>

      <label className="share-checkbox">
        <input type="checkbox" checked={depthEnabled} onChange={(e) => setDepthEnabled(e.target.checked)} />
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
            onChange={(e) => setMaxDepth(Number(e.target.value))}
          />
        </label>
      )}

      <label className="share-checkbox">
        <input type="checkbox" checked={expiryEnabled} onChange={(e) => setExpiryEnabled(e.target.checked)} />
        Set an expiration date
      </label>
      {expiryEnabled && (
        <label className="share-field share-field-nested">
          <span className="share-field-label">Expires</span>
          <input
            type="date"
            className="share-input"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </label>
      )}

      {error && <p className="share-error">{error}</p>}

      <button type="submit" className="share-submit" disabled={!effectiveRoot || pending}>
        {pending ? "Creating —" : "Create share"}
      </button>

      {createdLink && (
        <div className="share-result">
          <span className="share-field-label">Share link</span>
          <a href={createdLink} className="share-result-link">
            {createdLink}
          </a>
        </div>
      )}
    </form>
  );
}
