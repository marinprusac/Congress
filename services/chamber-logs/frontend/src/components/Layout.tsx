import { ChamberLayout, ChamberMark, getChamberIcon } from "@congress/congress-ui";

export function Layout() {
  return (
    <ChamberLayout
      icon={<ChamberMark name="logs" className="h-6 w-6 text-ink" />}
      title="Logs"
      ownChamber="logs"
      renderIcon={getChamberIcon}
    />
  );
}
