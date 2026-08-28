import { ChamberLayout, ChamberMark, getChamberIcon } from "@congress/congress-ui";

export function Layout() {
  return (
    <ChamberLayout
      icon={<ChamberMark name="fitness" className="h-8 w-8 text-ink" />}
      title="Fitness"
      ownChamber="fitness"
      renderIcon={getChamberIcon}
    />
  );
}
