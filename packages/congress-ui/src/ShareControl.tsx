import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CreateShareForm } from "./CreateShareForm.js";
import { SharePopover } from "./SharePopover.js";
import { exhibitSharingQueryKey } from "./useExhibitSharing.js";

interface ShareControlProps {
  chamber: string;
  exhibitId: string;
  exhibitName: string;
  className?: string;
}

// "Share" trigger + inline creation form for an exhibit's own view page -
// the exhibit is already known, so CreateShareForm skips its picker (see
// fixedRoot). Existing shares aren't listed here: the ExhibitSharingBadge
// next to the title is the indicator of a current share and is itself the
// link to view/manage one, and the full list lives on Capitol's Shares page -
// no need to duplicate that here too.
export function ShareControl({ chamber, exhibitId, exhibitName, className }: ShareControlProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  return (
    <div className={className ? `${className} share-control` : "share-control"}>
      <button type="button" className="share-control-trigger tap-target" onClick={() => setOpen((o) => !o)}>
        Share
      </button>
      <SharePopover open={open} onClose={() => setOpen(false)}>
        <CreateShareForm
          fixedRoot={{ chamber, id: exhibitId, name: exhibitName }}
          className="share-form"
          onCreated={() => queryClient.invalidateQueries({ queryKey: exhibitSharingQueryKey(exhibitId) })}
        />
      </SharePopover>
    </div>
  );
}
