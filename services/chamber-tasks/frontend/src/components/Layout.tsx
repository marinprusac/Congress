import { ChamberLayout, ChamberMark, getChamberIcon } from "@congress/exhibit-ui";

const NAV_LINKS = [
  { to: "/", label: "All Tasks" },
  { to: "/new", label: "New" },
  { to: "/settings", label: "Settings" },
];

export function Layout() {
  return (
    <ChamberLayout
      icon={<ChamberMark name="tasks" className="h-8 w-8 text-ink" />}
      title="Tasks"
      navLinks={NAV_LINKS}
      ownChamber="tasks"
      renderIcon={getChamberIcon}
    />
  );
}
