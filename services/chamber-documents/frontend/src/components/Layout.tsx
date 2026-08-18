import { ChamberLayout, ChamberMark, getChamberIcon } from "@congress/congress-ui";

export function Layout() {
  return (
    <ChamberLayout
      icon={<ChamberMark name="documents" className="h-8 w-8 text-ink" />}
      title="Documents"
      ownChamber="documents"
      renderIcon={getChamberIcon}
    />
  );
}
