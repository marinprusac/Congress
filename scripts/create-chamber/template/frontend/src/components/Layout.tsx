import { ChamberLayout, ChamberMark, getChamberIcon } from "@congress/congress-ui";

const NAV_LINKS = [
  { to: "/", label: "All __CHAMBER_DISPLAY__" },
  { to: "/new", label: "New" },
  { to: "/settings", label: "Settings" },
];

export function Layout() {
  return (
    <ChamberLayout
      icon={<ChamberMark name="__CHAMBER_NAME__" className="h-8 w-8 text-ink" />}
      title="__CHAMBER_DISPLAY__"
      navLinks={NAV_LINKS}
      ownChamber="__CHAMBER_NAME__"
      renderIcon={getChamberIcon}
    />
  );
}
