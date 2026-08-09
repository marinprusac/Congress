import { Link, Outlet } from "react-router-dom";
import { FileText } from "lucide-react";

export function Layout() {
  return (
    <div className="min-h-screen bg-parchment text-ink">
      <header className="border-b border-dust px-6 py-8">
        <a href="/" className="block font-mono text-xs uppercase tracking-widest text-dust hover:text-accent">
          ← Capitol
        </a>
        <div className="flex items-baseline justify-between">
          <Link to="/" className="flex items-center gap-3">
            <FileText className="h-8 w-8 text-ink" strokeWidth={1.5} />
            <h1 className="font-display text-4xl">Documents</h1>
          </Link>
          <nav className="flex gap-4 font-mono text-xs uppercase tracking-wide text-slate">
            <Link to="/" className="hover:text-accent">
              All Documents
            </Link>
            <Link to="/new" className="hover:text-accent">
              Upload
            </Link>
            <Link to="/settings" className="hover:text-accent">
              Settings
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Outlet />
      </main>
    </div>
  );
}
