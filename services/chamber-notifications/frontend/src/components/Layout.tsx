import { ChamberLayout, ChamberMark, getChamberIcon } from "@congress/congress-ui";

const NAV_LINKS = [
  { to: "/", label: "Automations" },
  { to: "/new", label: "New" },
  { to: "/settings", label: "Settings" },
];

export function Layout() {
  return (
    <ChamberLayout
      icon={<ChamberMark name="notifications" className="h-8 w-8 text-ink" />}
      title="Notifications"
      navLinks={NAV_LINKS}
      ownChamber="notifications"
      renderIcon={getChamberIcon}
    />
  );
}
