import { Link } from "react-router-dom";
import { useState } from "react";
import {
  useShellHosted,
  resolveChamberPath,
  useSearchableList,
  useListRowPrefetch,
  ListSearchInput,
  ListLoadingState,
  ListErrorState,
  ListEmptyState,
} from "@congress/congress-ui";
import { fetchDirectives, fetchDirective, searchDirectives } from "@/lib/api";

export function DirectivesListPage() {
  const [query, setQuery] = useState("");
  const shellHosted = useShellHosted();

  const { data, isLoading, isError } = useSearchableList({
    queryKeyBase: "directives",
    query,
    fetchAll: fetchDirectives,
    fetchSearch: searchDirectives,
  });

  const prefetchDirective = useListRowPrefetch((id: number) => ["directive", id], fetchDirective);

  return (
    <section className="list-page">
      <ListSearchInput
        value={query}
        onChange={setQuery}
        placeholder="Search directives —"
        newHref={resolveChamberPath("/directives/new", "deputy", shellHosted)}
      />

      <div className="border-t border-dust">
        {isLoading && <ListLoadingState />}
        {isError && <ListErrorState label="Directives" />}
        {!isLoading && !isError && data?.length === 0 && <ListEmptyState label="directives" hasQuery={!!query} />}
        {!isLoading &&
          !isError &&
          data?.map((directive) => (
            <Link
              key={directive.id}
              to={resolveChamberPath(`/d/${directive.id}`, "deputy", shellHosted)}
              onMouseEnter={() => prefetchDirective(directive.id)}
              onFocus={() => prefetchDirective(directive.id)}
              className="block border-b border-dust px-1 py-3 hover:bg-ink/[0.03]"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className={`font-display text-lg ${directive.enabled ? "text-ink" : "text-dust line-through"}`}>{directive.title}</span>
                {!directive.enabled && <span className="shrink-0 font-mono text-xs text-dust">disabled</span>}
              </div>
              {directive.body && <p className="mt-1 truncate text-sm text-slate">{directive.body}</p>}
            </Link>
          ))}
      </div>
    </section>
  );
}
