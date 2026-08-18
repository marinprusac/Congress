import { ChamberLayout, ChamberMark, getChamberIcon } from "@congress/congress-ui";

export function Layout() {
  return (
    <ChamberLayout
      icon={<ChamberMark name="calendar" className="h-8 w-8 text-ink" />}
      title="Calendar"
      ownChamber="calendar"
      renderIcon={getChamberIcon}
    />
  );
}
