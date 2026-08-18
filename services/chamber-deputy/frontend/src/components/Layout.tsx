import { ChamberLayout, ChamberMark, getChamberIcon } from "@congress/congress-ui";

const NAV_LINKS = [
  { to: "/", label: "Chat" },
  { to: "/directives", label: "Directives" },
  { to: "/directives/new", label: "New" },
  { to: "/runs", label: "History" },
  { to: "/settings", label: "Settings" },
];

export function Layout() {
  return (
    <ChamberLayout
      icon={<ChamberMark name="deputy" className="h-8 w-8 text-ink" />}
      title="Deputy"
      navLinks={NAV_LINKS}
      ownChamber="deputy"
      renderIcon={getChamberIcon}
    />
  );
}
