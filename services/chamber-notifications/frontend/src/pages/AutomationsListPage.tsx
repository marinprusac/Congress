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
import { fetchAutomations, fetchAutomation, searchAutomations } from "@/lib/api";

export function AutomationsListPage() {
  const [query, setQuery] = useState("");
  const shellHosted = useShellHosted();

  const { data, isLoading, isError } = useSearchableList({
    queryKeyBase: "automations",
    query,
    fetchAll: fetchAutomations,
    fetchSearch: searchAutomations,
  });

  const prefetchAutomation = useListRowPrefetch((id: number) => ["automation", id], fetchAutomation);

  return (
    <section>
      <ListSearchInput value={query} onChange={setQuery} placeholder="Search automations —" />

      <div className="border-t border-dust">
        {isLoading && <ListLoadingState />}
        {isError && <ListErrorState label="Automations" />}
        {!isLoading && !isError && data?.length === 0 && <ListEmptyState label="automations" hasQuery={!!query} />}
        {!isLoading &&
          !isError &&
          data?.map((automation) => (
            <Link
              key={automation.id}
              to={resolveChamberPath(`/a/${automation.id}`, "notifications", shellHosted)}
              onMouseEnter={() => prefetchAutomation(automation.id)}
              onFocus={() => prefetchAutomation(automation.id)}
              className="block border-b border-dust px-1 py-3 hover:bg-ink/[0.03]"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-display text-lg text-ink">{automation.title}</span>
                <span className="shrink-0 font-mono text-xs text-dust">
                  {automation.enabled ? automation.triggerEventType : `${automation.triggerEventType} · disabled`}
                </span>
              </div>
              {automation.body && <p className="mt-1 text-sm text-slate">{automation.body}</p>}
            </Link>
          ))}
      </div>
    </section>
  );
}
