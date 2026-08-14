import { ChamberLayout } from "@congress/exhibit-ui";
import { CalendarMark } from "@/components/CalendarMark";
import { getChamberIcon } from "@/components/ChamberIcon";

const NAV_LINKS = [
  { to: "/", label: "Agenda" },
  { to: "/new", label: "New" },
  { to: "/settings", label: "Settings" },
];

export function Layout() {
  return (
    <ChamberLayout
      icon={<CalendarMark className="h-8 w-8 text-ink" />}
      title="Calendar"
      navLinks={NAV_LINKS}
      ownChamber="calendar"
      renderIcon={getChamberIcon}
    />
  );
}
