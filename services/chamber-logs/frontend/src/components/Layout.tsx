import { ChamberLayout, ChamberMark, getChamberIcon } from "@congress/congress-ui";

const NAV_LINKS = [
  { to: "/", label: "Rules" },
  { to: "/new", label: "New" },
  { to: "/settings", label: "Settings" },
];

export function Layout() {
  return (
    <ChamberLayout
      icon={<ChamberMark name="logs" className="h-8 w-8 text-ink" />}
      title="Logs"
      navLinks={NAV_LINKS}
      ownChamber="logs"
      renderIcon={getChamberIcon}
    />
  );
}
