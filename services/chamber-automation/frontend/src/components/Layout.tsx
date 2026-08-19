import { ChamberLayout, ChamberMark, getChamberIcon } from "@congress/congress-ui";

export function Layout() {
  return (
    <ChamberLayout
      icon={<ChamberMark name="automation" className="h-6 w-6 text-ink" />}
      title="Automation"
      ownChamber="automation"
      renderIcon={getChamberIcon}
    />
  );
}
