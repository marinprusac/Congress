import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { NavPanel, ChamberHeader, ChamberMark, getChamberIcon, useShellHosted, resolveChamberPath } from "@congress/congress-ui";

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
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const { pathname } = useLocation();
  // Chat (Deputy's home route) is the one page here that must fit the
  // viewport with no page-level scroll - see ChatPage's own internal
  // scroll region. Every other route (Directives, History, Settings) stays
  // an ordinary scrolling page, same split Capitol's own Layout draws for
  // its canvas homepage (see .chamber-shell--canvas in shared.css).
  const isHome = pathname === resolveChamberPath("/", "deputy", shellHosted);

  return (
    <div className={`chamber-shell${isHome ? " chamber-shell--canvas" : ""}`}>
      {!shellHosted && <NavPanel current="deputy" currentLabel="Deputy" />}
      <ChamberHeader
        icon={<ChamberMark name="deputy" className="h-8 w-8 text-ink" />}
        title="Deputy"
        ownChamber="deputy"
        renderIcon={getChamberIcon}
        navigate={navigate}
        extraActions={<DeputyHeaderLinks />}
      />
      <main className={`chamber-main${isHome ? " chamber-main--canvas" : ""}`}>
        <Outlet />
      </main>
    </div>
  );
}
