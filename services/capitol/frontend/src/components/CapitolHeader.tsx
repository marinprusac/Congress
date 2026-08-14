import { Link, useLocation, useNavigate } from "react-router-dom";
import { GlobalExhibitSearch, CapitolMark, ChamberMark } from "@congress/exhibit-ui";
import { SignOutControl } from "@/components/LoginGate";

export function CapitolHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const isHome = location.pathname === "/";

  return (
    <header className="border-b border-dust px-6 py-8">
      {!isHome && (
        <Link
          to="/"
          className="mb-2 block font-mono text-xs uppercase tracking-widest text-dust hover:text-accent"
        >
          ← Capitol
        </Link>
      )}
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-dust">Congress</p>
          <div className="flex items-center gap-3">
            <CapitolMark className="h-8 w-8 text-ink" />
            <Link to="/" className="font-display text-4xl text-ink">
              Capitol
            </Link>
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-5 sm:w-auto sm:justify-end">
          <GlobalExhibitSearch
            ownChamber=""
            navigate={navigate}
            renderIcon={(chamber) => <ChamberMark name={chamber} />}
          />
          <Link to="/shares" className="font-mono text-xs uppercase tracking-wide text-dust hover:text-ink">
            Shares
          </Link>
          <Link to="/settings" className="font-mono text-xs uppercase tracking-wide text-dust hover:text-ink">
            Settings
          </Link>
          <SignOutControl />
        </div>
      </div>
    </header>
  );
}
