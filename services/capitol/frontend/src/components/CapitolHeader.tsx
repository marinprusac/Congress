import { Link } from "react-router-dom";
import { SignOutControl } from "@/components/LoginGate";
import { CapitolMark } from "@/components/icons";

export function CapitolHeader() {
  return (
    <header className="flex items-start justify-between border-b border-dust px-6 py-8">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-dust">Congress</p>
        <div className="flex items-center gap-3">
          <CapitolMark className="h-8 w-8 text-ink" />
          <Link to="/" className="font-display text-4xl text-ink">
            Capitol
          </Link>
        </div>
      </div>
      <div className="flex items-center gap-5">
        <Link to="/shares" className="font-mono text-xs uppercase tracking-wide text-dust hover:text-ink">
          Shares
        </Link>
        <SignOutControl />
      </div>
    </header>
  );
}
