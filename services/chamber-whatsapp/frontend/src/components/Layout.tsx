import { ChamberLayout, ChamberMark } from "@congress/congress-ui";

export function Layout() {
  return (
    <ChamberLayout
      icon={<ChamberMark name="whatsapp" className="h-8 w-8 text-ink" />}
      title="WhatsApp"
      ownChamber="whatsapp"
    />
  );
}
