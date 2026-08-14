import { ChamberLayout, ChamberMark, getChamberIcon } from "@congress/exhibit-ui";

const NAV_LINKS = [
  { to: "/", label: "All Notes" },
  { to: "/new", label: "New" },
  { to: "/settings", label: "Settings" },
];

export function Layout() {
  return (
    <ChamberLayout
      icon={<ChamberMark name="notes" className="h-8 w-8 text-ink" />}
      title="Notes"
      navLinks={NAV_LINKS}
      ownChamber="notes"
      renderIcon={getChamberIcon}
    />
  );
}
