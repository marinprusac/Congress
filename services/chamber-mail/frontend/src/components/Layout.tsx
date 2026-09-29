import { ChamberLayout, ChamberMark } from "@congress/congress-ui";

export function Layout() {
  return (
    <ChamberLayout
      icon={<ChamberMark name="mail" className="h-8 w-8 text-ink" />}
      title="Mail"
      ownChamber="mail"
    />
  );
}
