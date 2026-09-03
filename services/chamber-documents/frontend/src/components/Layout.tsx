import { ChamberLayout, ChamberMark } from "@congress/congress-ui";

export function Layout() {
  return (
    <ChamberLayout icon={<ChamberMark name="documents" className="h-6 w-6 text-ink" />} title="Documents" ownChamber="documents" />
  );
}
