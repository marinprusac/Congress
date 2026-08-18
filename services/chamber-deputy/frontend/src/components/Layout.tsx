import { Link, useLocation } from "react-router-dom";
import { ChamberLayout, ChamberMark, getChamberIcon, useShellHosted, resolveChamberPath } from "@congress/congress-ui";

// Deputy's home is Chat, not a list page - Directives and History are
// separate sections with no "default page" to collapse into, so (unlike
// every other Chamber) they still need their own header links rather than
// just a list page's "+" and a header Settings icon.
function DeputyHeaderLinks() {
  const { pathname } = useLocation();
  const shellHosted = useShellHosted();
  const links = [
    { to: "/directives", label: "Directives" },
    { to: "/runs", label: "History" },
  ];
  return (
    <>
      {links.map((link) => {
        const to = resolveChamberPath(link.to, "deputy", shellHosted);
        return (
          <Link key={link.to} to={to} className={pathname === to ? "chamber-header-link active" : "chamber-header-link"}>
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
      icon={<ChamberMark name="deputy" className="h-8 w-8 text-ink" />}
      title="Deputy"
      ownChamber="deputy"
      renderIcon={getChamberIcon}
      extraActions={<DeputyHeaderLinks />}
    />
  );
}
