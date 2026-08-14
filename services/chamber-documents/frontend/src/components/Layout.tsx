import { ChamberLayout } from "@congress/exhibit-ui";
import { FileText } from "lucide-react";
import { getChamberIcon } from "@/components/ChamberIcon";

const NAV_LINKS = [
  { to: "/", label: "All Documents" },
  { to: "/new", label: "Upload" },
  { to: "/settings", label: "Settings" },
];

export function Layout() {
  return (
    <ChamberLayout
      icon={<FileText className="h-8 w-8 text-ink" strokeWidth={1.5} />}
      title="Documents"
      navLinks={NAV_LINKS}
      ownChamber="documents"
      renderIcon={getChamberIcon}
    />
  );
}
