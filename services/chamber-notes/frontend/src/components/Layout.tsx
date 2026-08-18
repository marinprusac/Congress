import { ChamberLayout, ChamberMark, getChamberIcon } from "@congress/congress-ui";

export function Layout() {
  return (
    <ChamberLayout
      icon={<ChamberMark name="notes" className="h-8 w-8 text-ink" />}
      title="Notes"
      ownChamber="notes"
      renderIcon={getChamberIcon}
    />
  );
}
