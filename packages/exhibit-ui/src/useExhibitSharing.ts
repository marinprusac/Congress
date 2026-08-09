import { useEffect, useState } from "react";
import type { ExhibitSharingEntry } from "@congress/shared-types";

const SHARING_URL = (id: string) => `/capitol/exhibits/${encodeURIComponent(id)}/sharing`;

// Drives the "Shared" / "Shared (inherited)" badge on a Chamber's own view
// pages - the owner-facing counterpart to a share recipient's token-scoped
// view. Recomputed on every mount/id-change rather than cached, so editing
// an exhibit to add a new [[ reference (making the newly-referenced exhibit
// inherited-shared) is reflected the next time its page is visited.
export function useExhibitSharing(exhibitId: string): { entries: ExhibitSharingEntry[]; loading: boolean } {
  const [entries, setEntries] = useState<ExhibitSharingEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch(SHARING_URL(exhibitId))
      .then((res) => (res.ok ? res.json() : { shares: [] }))
      .then((data: { shares: ExhibitSharingEntry[] }) => {
        if (!cancelled) setEntries(data.shares);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [exhibitId]);

  return { entries, loading };
}
