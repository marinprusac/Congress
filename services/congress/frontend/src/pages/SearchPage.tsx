import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChamberHeader,
  ChamberMark,
  fetchRegistry,
  resolveChamberPath,
  TransitionLink,
  useAppliedTheme,
  useExhibitSearch,
  useTransitionNavigate,
} from "@congress/congress-ui";
import { viewHref } from "@/components/ViewSlot";

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" className="h-6 w-6 text-ink" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  );
}

// Search doubles as the way into everything: before typing, every view
// every active Chamber offers (the catalog - what used to be each Chamber's
// own nav) and the most recent exhibits; while typing, matching views and
// exhibits across every Chamber.
export function SearchPage() {
  useAppliedTheme();
  const navigate = useTransitionNavigate();
  const [query, setQuery] = useState("");
  const { data: registry } = useQuery({ queryKey: ["congress", "registry"], queryFn: fetchRegistry });
  const { results, loading } = useExhibitSearch(query, true);

  const needle = query.trim().toLowerCase();
  const chambers = (registry ?? []).filter((c) => c.status === "active" && (c.views ?? []).length > 0);
  const views = chambers.flatMap((c) =>
    (c.views ?? [])
      .filter((v) => !needle || v.label.toLowerCase().includes(needle) || c.displayName.toLowerCase().includes(needle))
      .map((v) => ({ chamber: c, view: v }))
  );
  const displayNames = new Map((registry ?? []).map((c) => [c.name, c.displayName]));

  return (
    <div className="chamber-shell">
      <ChamberHeader icon={<SearchIcon />} title="Search" titleHref="" />
      <main className="chamber-main">
        <input
          type="search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Congress —"
          aria-label="Search Congress"
          className="search-input"
          enterKeyHint="search"
        />

        {views.length > 0 && (
          <>
            <h2 className="search-section-title">Views</h2>
            {views.map(({ chamber, view }) => (
              <TransitionLink key={`${chamber.name}:${view.id}`} to={viewHref(chamber.name, view)} className="search-row">
                <ChamberMark name={chamber.name} />
                <span className="search-row-name">{view.label}</span>
                <span className="search-row-meta">{chamber.displayName}</span>
              </TransitionLink>
            ))}
          </>
        )}

        <h2 className="search-section-title">{needle ? "Exhibits" : "Recent"}</h2>
        {loading && results.length === 0 && <p className="font-mono text-xs text-dust">Searching —</p>}
        {!loading && results.length === 0 && <p className="font-mono text-xs text-dust">{needle ? "No matches" : "— Nothing yet —"}</p>}
        {results.map((result) => (
          <button
            key={`${result.chamber}:${result.id}`}
            type="button"
            className="search-row"
            onClick={() => navigate(resolveChamberPath(result.url, result.chamber, true))}
          >
            <ChamberMark name={result.chamber} />
            <span className="search-row-name">{result.name}</span>
            <span className="search-row-meta">{displayNames.get(result.chamber) ?? result.chamber}</span>
          </button>
        ))}
      </main>
    </div>
  );
}
