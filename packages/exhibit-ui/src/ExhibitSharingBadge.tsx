import { useExhibitSharing } from "./useExhibitSharing.js";

interface ExhibitSharingBadgeProps {
  exhibitId: string;
  className?: string;
}

// Renders nothing when the exhibit isn't shared at all. When it's shared
// both directly (it's some share's own root) and only indirectly (reached
// via another exhibit's [[ reference), direct takes visual precedence -
// this is exactly what depth 0 vs depth > 0 in the closure means.
export function ExhibitSharingBadge({ exhibitId, className }: ExhibitSharingBadgeProps) {
  const { entries, loading } = useExhibitSharing(exhibitId);
  if (loading || entries.length === 0) return null;

  const direct = entries.filter((e) => e.direct);
  const relevant = direct.length > 0 ? direct : entries;
  const isDirect = direct.length > 0;
  const labels = relevant.map((e) => e.label || "Untitled share").join(", ");

  return (
    <span className={className} data-sharing-state={isDirect ? "direct" : "inherited"} title={`Shared via: ${labels}`}>
      {isDirect ? "Shared" : "Shared (inherited)"}
    </span>
  );
}
