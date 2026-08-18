import { ChamberLayout, ChamberMark, getChamberIcon } from "@congress/congress-ui";

export function Layout() {
  return (
    <ChamberLayout
      icon={<ChamberMark name="__CHAMBER_NAME__" className="h-8 w-8 text-ink" />}
      title="__CHAMBER_DISPLAY__"
      ownChamber="__CHAMBER_NAME__"
      renderIcon={getChamberIcon}
    />
  );
}
