import { useState } from "react";
import { useExhibitSharing } from "./useExhibitSharing.js";
import { EditShareModal } from "./EditShareModal.js";

interface ExhibitSharingBadgeProps {
  exhibitId: string;
  className?: string;
}

// Renders nothing when the exhibit isn't shared at all. When it's shared
// both directly (it's some share's own root) and only indirectly (reached
// via another exhibit's [[ reference), direct takes visual precedence -
// this is exactly what depth 0 vs depth > 0 in the closure means.
//
// Doubles as the owner's entry point to manage that share: clicking it opens
// EditShareModal scoped to the first relevant share, rather than navigating
// to the recipient-facing /shared view (that page is for people without a
// Congress login, not for the owner editing their own share).
export function ExhibitSharingBadge({ exhibitId, className }: ExhibitSharingBadgeProps) {
  const { entries, loading } = useExhibitSharing(exhibitId);
  const [open, setOpen] = useState(false);
  if (loading || entries.length === 0) return null;

  const direct = entries.filter((e) => e.direct);
  const relevant = direct.length > 0 ? direct : entries;
  const isDirect = direct.length > 0;
  const labels = relevant.map((e) => e.label || "Untitled share").join(", ");
  const target = relevant[0]!;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className}
        data-sharing-state={isDirect ? "direct" : "inherited"}
        title={`Shared via: ${labels}`}
      >
        {isDirect ? "Shared" : "Shared (inherited)"}
      </button>
      {open && (
        <EditShareModal exhibitId={exhibitId} token={target.token} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
