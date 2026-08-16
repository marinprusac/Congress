import { SharePopover, CreateShareForm } from "@congress/congress-ui";

// Real usage: ShareControl.tsx wraps its trigger + this popover in a
// ".share-control" div, which supplies the anchor SharePopover's own
// ".share-control-popover" CSS positions against (see that component's own
// comment) - reproduced verbatim (trigger button included) since without it
// ".share-control" has no in-flow content and collapses to zero height,
// leaving the absolutely-positioned popover with nothing to anchor a
// measurable box against. `open` is a plain prop here (unlike
// NotificationBell), so no click-simulation trick is needed.
//
// The popover is right-anchored to its trigger and extends 320px leftward
// (desktop CSS: `inset: calc(100% + 0.5rem) 0 auto auto`) - in the real app
// ShareControl always sits well clear of the left edge (inside an
// ExhibitActionBar row or a page header), so this gives the trigger the same
// clearance a real page would, instead of clipping off-card.

export function Open() {
  return (
    <div style={{ paddingLeft: "22rem" }}>
      <div className="share-control">
        <button type="button" className="share-control-trigger">
          Share
        </button>
        <SharePopover open onClose={() => {}}>
          <CreateShareForm
            fixedRoot={{ chamber: "notes", id: "note-9", name: "Congress Development" }}
            className="share-form"
          />
        </SharePopover>
      </div>
    </div>
  );
}
