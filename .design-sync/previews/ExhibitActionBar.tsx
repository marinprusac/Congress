import { ExhibitActionBar, ShareControl } from "@congress/congress-ui";

// Real usage, ported verbatim from chamber-notes/NoteViewPage.tsx: two
// distinct button clusters depending on mode - view mode (Pin/Share/Edit/
// Delete, ShareControl composed directly in) and edit mode (Save/Cancel) -
// same tap-target/text-accent/text-slate/text-alert classes the real page
// uses, not invented ones.

export function ViewMode() {
  return (
    <ExhibitActionBar>
      <button className="tap-target text-accent hover:underline">Unpin</button>
      <ShareControl chamber="notes" exhibitId="note-9" exhibitName="Congress Development" />
      <button className="tap-target text-accent hover:underline">Edit</button>
      <button className="tap-target text-alert hover:underline">Delete</button>
    </ExhibitActionBar>
  );
}

export function EditMode() {
  return (
    <ExhibitActionBar>
      <button className="tap-target text-accent hover:underline">Save</button>
      <button className="tap-target text-slate hover:underline">Cancel</button>
    </ExhibitActionBar>
  );
}
