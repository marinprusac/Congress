import { ChamberLayout, ChamberMark, getChamberIcon } from "@congress/congress-ui";

const NAV_LINKS = [
  { to: "/", label: "Automations" },
  { to: "/new", label: "New" },
  { to: "/settings", label: "Settings" },
];

export function Layout() {
  return (
    <ChamberLayout
      icon={<ChamberMark name="automation" className="h-8 w-8 text-ink" />}
      title="Automation"
      navLinks={NAV_LINKS}
      ownChamber="automation"
      renderIcon={getChamberIcon}
    />
  );
}
