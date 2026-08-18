import { ChamberLayout, ChamberMark, getChamberIcon } from "@congress/congress-ui";

export function Layout() {
  return (
    <ChamberLayout
      icon={<ChamberMark name="tasks" className="h-8 w-8 text-ink" />}
      title="Tasks"
      ownChamber="tasks"
      renderIcon={getChamberIcon}
    />
  );
}
