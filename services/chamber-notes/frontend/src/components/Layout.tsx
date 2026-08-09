import { ChamberLayout } from "@congress/exhibit-ui";
import { NotesMark } from "@/components/NotesMark";

const NAV_LINKS = [
  { to: "/", label: "All Notes" },
  { to: "/new", label: "New" },
  { to: "/settings", label: "Settings" },
];

export function Layout() {
  return <ChamberLayout icon={<NotesMark className="h-8 w-8 text-ink" />} title="Notes" navLinks={NAV_LINKS} />;
}
