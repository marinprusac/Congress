import { ChamberLayout, ChamberMark, getChamberIcon } from "@congress/congress-ui";

const NOTES_NAV_LINKS = [
  { to: "/", label: "All Notes" },
  { to: "/new", label: "New" },
  { to: "/settings", label: "Settings" },
];

export function NotesChamber() {
  return (
    <ChamberLayout
      icon={<ChamberMark name="notes" className="h-8 w-8 text-ink" />}
      title="Notes"
      navLinks={NOTES_NAV_LINKS}
      ownChamber="notes"
      renderIcon={getChamberIcon}
    />
  );
}
