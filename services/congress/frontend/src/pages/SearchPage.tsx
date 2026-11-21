import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ChamberHeader,
  ChamberMark,
  RecordTypeIcon,
  resolveChamberPath,
  StackLink,
  useAppliedTheme,
  useRecordSearch,
  useStackNav,
} from "@congress/congress-ui";
import { fetchTypes } from "@/lib/recordsApi";
import { TYPES_KEY } from "@/records/RecordPage";

// Search: the most recent records before typing, matching records while typing.
export function SearchPage() {
  useAppliedTheme();
  const nav = useStackNav();
  // In the URL, so coming back to Search (a pop, or the tab restored)
  // finds the same query.
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const setQuery = (next: string) => setParams(next ? { q: next } : {}, { replace: true });
  const { results, loading } = useRecordSearch(query, true);
  const { data: types } = useQuery({ queryKey: TYPES_KEY, queryFn: fetchTypes });
  const typeLabels = new Map((types ?? []).map((t) => [t.definition.slug, t.definition.label]));

  const needle = query.trim().toLowerCase();

  return (
    <div className="chamber-shell">
      <ChamberHeader title="Search" titleHref="" />
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

        <h2 className="search-section-title">{needle ? "Records" : "Recent"}</h2>
        {loading && results.length === 0 && <p className="font-mono text-xs text-dust">Searching —</p>}
        {!loading && results.length === 0 && <p className="font-mono text-xs text-dust">{needle ? "No matches" : "— Nothing yet —"}</p>}
        {results.map((result) => (
          <button
            key={`${result.chamber}:${result.id}`}
            type="button"
            className="search-row"
            onClick={() => nav.push(resolveChamberPath(result.url, result.chamber))}
          >
            {result.chamber === "e" ? <RecordTypeIcon type={result.type} /> : <ChamberMark name={result.chamber} />}
            <span className="search-row-name">{result.name}</span>
            <span className="search-row-meta">{result.chamber === "e" ? (typeLabels.get(result.type) ?? result.type) : result.chamber}</span>
          </button>
        ))}
      </main>
    </div>
  );
}
