import { ChamberLayout, ChamberMark } from "@congress/congress-ui";

export function Layout() {
  return (
    <ChamberLayout icon={<ChamberMark name="calendar" className="h-6 w-6 text-ink" />} title="Calendar" ownChamber="calendar" />
  );
}
