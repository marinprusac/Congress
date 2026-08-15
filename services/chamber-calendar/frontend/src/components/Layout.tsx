import { ChamberLayout, ChamberMark, getChamberIcon } from "@congress/congress-ui";

const NAV_LINKS = [
  { to: "/", label: "Agenda" },
  { to: "/new", label: "New" },
  { to: "/settings", label: "Settings" },
];

export function Layout() {
  return (
    <ChamberLayout
      icon={<ChamberMark name="calendar" className="h-8 w-8 text-ink" />}
      title="Calendar"
      navLinks={NAV_LINKS}
      ownChamber="calendar"
      renderIcon={getChamberIcon}
    />
  );
}
