import { Link, useLocation } from "react-router-dom";
import { ChamberLayout, ChamberMark, getChamberIcon, useShellHosted, resolveChamberPath } from "@congress/congress-ui";

// Map's home is the map itself, not a list page - Places and Pending are
// separate sections with no "default page" to collapse into, same reasoning
// as Deputy's own Directives/History header links.
function MapHeaderLinks() {
  const { pathname } = useLocation();
  const shellHosted = useShellHosted();
  const links = [
    { to: "/places", label: "Places" },
    { to: "/pending", label: "Pending" },
  ];
  return (
    <>
      {links.map((link) => {
        const to = resolveChamberPath(link.to, "map", shellHosted);
        return (
          <Link
            key={link.to}
            to={to}
            className={pathname.startsWith(to) ? "chamber-header-link active" : "chamber-header-link"}
          >
            {link.label}
          </Link>
        );
      })}
    </>
  );
}

export function Layout() {
  return (
    <ChamberLayout
      icon={<ChamberMark name="map" className="h-8 w-8 text-ink" />}
      title="Map"
      ownChamber="map"
      renderIcon={getChamberIcon}
      extraActions={<MapHeaderLinks />}
    />
  );
}
