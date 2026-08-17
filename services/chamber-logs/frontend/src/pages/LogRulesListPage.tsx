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
import { fetchLogRules, fetchLogRule, searchLogRules } from "@/lib/api";

export function LogRulesListPage() {
  const [query, setQuery] = useState("");
  const shellHosted = useShellHosted();

  const { data, isLoading, isError } = useSearchableList({
    queryKeyBase: "log-rules",
    query,
    fetchAll: fetchLogRules,
    fetchSearch: searchLogRules,
  });

  const prefetchRule = useListRowPrefetch((id: number) => ["log-rule", id], fetchLogRule);

  return (
    <section>
      <ListSearchInput value={query} onChange={setQuery} placeholder="Search log rules —" />

      <div className="border-t border-dust">
        {isLoading && <ListLoadingState />}
        {isError && <ListErrorState label="Log rules" />}
        {!isLoading && !isError && data?.length === 0 && <ListEmptyState label="log rules" hasQuery={!!query} />}
        {!isLoading &&
          !isError &&
          data?.map((rule) => (
            <Link
              key={rule.id}
              to={resolveChamberPath(`/r/${rule.id}`, "logs", shellHosted)}
              onMouseEnter={() => prefetchRule(rule.id)}
              onFocus={() => prefetchRule(rule.id)}
              className="block border-b border-dust px-1 py-3 hover:bg-ink/[0.03]"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-display text-lg text-ink">{rule.title}</span>
                <span className="shrink-0 font-mono text-xs text-dust">
                  {rule.enabled ? rule.triggerEventType : `${rule.triggerEventType} · disabled`}
                </span>
              </div>
              {rule.body && <p className="mt-1 text-sm text-slate">{rule.body}</p>}
            </Link>
          ))}
      </div>
    </section>
  );
}
