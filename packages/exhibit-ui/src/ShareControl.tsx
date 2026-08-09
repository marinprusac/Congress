import { useState } from "react";
import { CreateShareForm } from "./CreateShareForm.js";

interface ShareControlProps {
  chamber: string;
  exhibitId: string;
  exhibitName: string;
  className?: string;
}

// "Share" trigger + inline panel for an exhibit's own view page - the
// exhibit is already known, so this skips CreateShareForm's picker entirely
// (see fixedRoot). Toggle-only, like ExhibitPickerDropdown, rather than a
// portal/modal - keeps focus and DOM structure simple for a form this small.
export function ShareControl({ chamber, exhibitId, exhibitName, className }: ShareControlProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className={className ? `${className} share-control` : "share-control"}>
      <button type="button" className="share-control-trigger" onClick={() => setOpen((o) => !o)}>
        Share
      </button>
      <div className="share-control-popover" hidden={!open}>
        <CreateShareForm fixedRoot={{ chamber, id: exhibitId, name: exhibitName }} className="share-form" />
      </div>
    </div>
  );
}
