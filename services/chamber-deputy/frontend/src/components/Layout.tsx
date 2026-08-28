import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { NavPanel, ChamberHeader, ChamberMark, getChamberIcon, useShellHosted, resolveChamberPath } from "@congress/congress-ui";

export function Layout() {
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const { pathname } = useLocation();
  // Chat is the one page here that must fit the viewport with no
  // page-level scroll - see ChatPage's own internal scroll region. Every
  // other route (Directives - now home - and Settings) stays an ordinary
  // scrolling page, same split Capitol's own Layout draws for its canvas
  // homepage (see .chamber-shell--canvas in shared.css).
  const isChat = pathname === resolveChamberPath("/chat", "deputy", shellHosted);

  return (
    <div className={`chamber-shell${isChat ? " chamber-shell--canvas" : ""}`}>
      {!shellHosted && <NavPanel current="deputy" currentLabel="Deputy" />}
      <ChamberHeader
        icon={<ChamberMark name="deputy" className="h-8 w-8 text-ink" />}
        title="Deputy"
        ownChamber="deputy"
        renderIcon={getChamberIcon}
        navigate={navigate}
      />
      <main className={`chamber-main${isChat ? " chamber-main--canvas" : ""}`}>
        <Outlet />
      </main>
    </div>
  );
}
