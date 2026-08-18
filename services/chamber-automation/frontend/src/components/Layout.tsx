import { ChamberLayout, ChamberMark, getChamberIcon } from "@congress/congress-ui";

export function Layout() {
  return (
    <ChamberLayout
      icon={<ChamberMark name="automation" className="h-8 w-8 text-ink" />}
      title="Automation"
      ownChamber="automation"
      renderIcon={getChamberIcon}
    />
  );
}
