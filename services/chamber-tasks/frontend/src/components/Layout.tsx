import { ChamberLayout, ChamberMark } from "@congress/congress-ui";

export function Layout() {
  return <ChamberLayout icon={<ChamberMark name="tasks" className="h-6 w-6 text-ink" />} title="Tasks" ownChamber="tasks" />;
}
