import { ChamberLayout, ChamberMark, getChamberIcon } from "@congress/exhibit-ui";

const NAV_LINKS = [
  { to: "/", label: "All Documents" },
  { to: "/new", label: "Upload" },
  { to: "/settings", label: "Settings" },
];

export function Layout() {
  return (
    <ChamberLayout
      icon={<ChamberMark name="documents" className="h-8 w-8 text-ink" />}
      title="Documents"
      navLinks={NAV_LINKS}
      ownChamber="documents"
      renderIcon={getChamberIcon}
    />
  );
}
