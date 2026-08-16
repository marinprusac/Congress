import { useNavigate } from "react-router-dom";
import { ChamberHeader, CapitolMark, ChamberMark, NotificationBell } from "@congress/congress-ui";

// The notification center is Capitol-owned chrome (see NotificationBell's
// own comment) - it's passed in here as ChamberHeader's extraActions rather
// than baked into that shared component, so it shows up on every Capitol
// page (Home, Shares, Settings all render CapitolHeader) without also
// showing up on every Chamber's own header.
export function CapitolHeader() {
  const navigate = useNavigate();

  return (
    <ChamberHeader
      icon={<CapitolMark className="h-8 w-8 text-ink" />}
      title="Capitol"
      ownChamber=""
      renderIcon={(chamber) => <ChamberMark name={chamber} />}
      navigate={(path) => navigate(path)}
      extraActions={<NotificationBell ownChamber="" navigate={(path) => navigate(path)} />}
    />
  );
}
