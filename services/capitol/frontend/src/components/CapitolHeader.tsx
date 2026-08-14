import { Link, useLocation, useNavigate } from "react-router-dom";
import { GlobalExhibitSearch } from "@congress/exhibit-ui";
import { SignOutControl } from "@/components/LoginGate";
import { CapitolMark, ChamberMark } from "@/components/icons";

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
      <div className="flex items-start justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-dust">Congress</p>
          <div className="flex items-center gap-3">
            <CapitolMark className="h-8 w-8 text-ink" />
            <Link to="/" className="font-display text-4xl text-ink">
              Capitol
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-5">
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
