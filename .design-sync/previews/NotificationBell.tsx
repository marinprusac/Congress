import { useEffect, useRef } from "react";
import { NotificationBell } from "@congress/congress-ui";

// Real usage: CapitolHeader.tsx mounts this as ChamberHeader's extraActions
// with ownChamber="" (Capitol isn't itself a Chamber) - see that file's own
// comment for why it's Capitol-owned chrome rather than baked into
// ChamberHeader directly.

// NotificationBell manages its open/closed panel state internally (no prop
// to force it open) - the real trigger is a click on its own bell button.
// Same idiom as ExhibitPickerDropdown's caret-position trick in NOTES.md:
// simulate the real interaction via a ref effect on mount so the open panel
// state is what the capture actually screenshots.
function OpenNotificationBell() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>(".notification-bell-trigger")?.click();
  }, []);

  return (
    <div ref={ref}>
      <NotificationBell ownChamber="" navigate={() => {}} />
    </div>
  );
}

export function Open() {
  return <OpenNotificationBell />;
}

export function Closed() {
  return <NotificationBell ownChamber="" navigate={() => {}} />;
}
