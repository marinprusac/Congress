import { Link } from "react-router-dom";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useShellHosted,
  resolveChamberPath,
  useSearchableList,
  useListRowPrefetch,
  ListSearchInput,
  ListLoadingState,
  ListErrorState,
  ListEmptyState,
  showToast,
} from "@congress/congress-ui";
import { fetchDirectives, fetchDirective, searchDirectives, runDirective } from "@/lib/api";

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="1.1em" height="1.1em">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em">
      <path d="M6 4.5v15l13-7.5z" />
    </svg>
  );
}

// Minutes for a clean multiple of an hour/day, otherwise raw minutes - just
// enough to make a directive's own schedule scannable in the list without a
// full duration-formatting utility for what's always a short round number.
function formatInterval(intervalMs: number): string {
  const minutes = Math.round(intervalMs / 60_000);
  if (minutes % 1440 === 0) return `every ${minutes / 1440}d`;
  if (minutes % 60 === 0) return `every ${minutes / 60}h`;
  return `every ${minutes}m`;
}

export function DirectivesListPage() {
  const [query, setQuery] = useState("");
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useSearchableList({
    queryKeyBase: "directives",
    query,
    fetchAll: fetchDirectives,
    fetchSearch: searchDirectives,
  });

  const prefetchDirective = useListRowPrefetch((id: number) => ["directive", id], fetchDirective);

  const runMutation = useMutation({
    mutationFn: (id: number) => runDirective(id),
    onSuccess: (result, id) => {
      queryClient.invalidateQueries({ queryKey: ["directive", id] });
      showToast(result.ok ? "Directive run complete" : (result.errorMessage ?? "Directive run failed."), result.ok ? "success" : "error");
    },
    onError: () => showToast("Failed to run directive.", "error"),
  });

  return (
    <section className="list-page">
      <ListSearchInput
        value={query}
        onChange={setQuery}
        placeholder="Search directives —"
        newHref={resolveChamberPath("/directives/new", "deputy", shellHosted)}
        leading={
          <Link to={resolveChamberPath("/chat", "deputy", shellHosted)} className="list-search-new" aria-label="Chat" title="Chat">
            <ChatIcon />
          </Link>
        }
      />

      <div className="border-t border-dust">
        {isLoading && <ListLoadingState />}
        {isError && <ListErrorState label="Directives" />}
        {!isLoading && !isError && data?.length === 0 && <ListEmptyState label="directives" hasQuery={!!query} />}
        {!isLoading &&
          !isError &&
          data?.map((directive) => (
            <div key={directive.id} className="flex items-stretch gap-1 border-b border-dust">
              <Link
                to={resolveChamberPath(`/d/${directive.id}`, "deputy", shellHosted)}
                onMouseEnter={() => prefetchDirective(directive.id)}
                onFocus={() => prefetchDirective(directive.id)}
                className="block min-w-0 flex-1 px-1 py-3 hover:bg-ink/[0.03]"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`font-display text-lg ${directive.enabled ? "text-ink" : "text-dust line-through"}`}>{directive.title}</span>
                  <span className="flex shrink-0 items-center gap-2 font-mono text-xs text-dust">
                    {directive.intervalMs != null && formatInterval(directive.intervalMs)}
                    {!directive.enabled && "disabled"}
                  </span>
                </div>
                {directive.body && <p className="mt-1 truncate text-sm text-slate">{directive.body}</p>}
              </Link>
              <button
                type="button"
                onClick={() => runMutation.mutate(directive.id)}
                disabled={runMutation.isPending && runMutation.variables === directive.id}
                aria-label={`Run "${directive.title}" now`}
                title="Run now"
                className="tap-target flex shrink-0 items-center px-3 text-slate hover:text-accent disabled:opacity-50"
              >
                <PlayIcon />
              </button>
            </div>
          ))}
      </div>
    </section>
  );
}
