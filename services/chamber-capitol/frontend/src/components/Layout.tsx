import { Outlet, useNavigate } from "react-router-dom";
import { ChamberPicker, ChamberHeader, CapitolMark, ChamberMark, NotificationBell } from "@congress/congress-ui";

const NAV_LINKS = [
  { to: "/", label: "Home" },
  { to: "/shares", label: "Shares" },
  { to: "/settings", label: "Settings" },
];

// Composes ChamberPicker/ChamberHeader by hand instead of the shared
// ChamberLayout wrapper (see every other Chamber's own Layout.tsx) so the
// notification center - Capitol-owned chrome, see NotificationBell's own
// comment - can be threaded in as ChamberHeader's extraActions.
export function Layout() {
  const navigate = useNavigate();

  return (
    <div className="chamber-shell">
      <ChamberPicker current="capitol" currentNavLinks={NAV_LINKS} currentLabel="Capitol" />
      <ChamberHeader
        icon={<CapitolMark className="h-8 w-8 text-ink" />}
        title="Capitol"
        ownChamber="capitol"
        renderIcon={(chamber) => <ChamberMark name={chamber} />}
        navigate={(path) => navigate(path)}
        extraActions={<NotificationBell ownChamber="capitol" navigate={(path) => navigate(path)} />}
      />
      <main className="chamber-main">
        <Outlet />
      </main>
    </div>
  );
}
