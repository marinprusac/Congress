import { useState } from "react";
import {
  useSearchableList,
  useListRowPrefetch,
  getChamberIcon,
  ListSearchInput,
  ListLoadingState,
  ListErrorState,
  ListEmptyState,
} from "@congress/congress-ui";
import type { EventSettingsSummary } from "@congress/shared-types";
import { fetchEventSettingsList, fetchEventSettings } from "@/lib/logsApi";

function matches(row: EventSettingsSummary, query: string): boolean {
  return row.label.toLowerCase().includes(query) || row.chamber.toLowerCase().includes(query) || row.eventType.toLowerCase().includes(query);
}

// Every known event type - auto-derived from Congress's own live Chamber
// registry, see eventCatalogSync.ts on the backend. No "new" entry point: there is
// nothing to create, only existing rows to configure.
export function EventSettingsListPage({ onOpen }: { onOpen: (eventType: string) => void }) {
  const [query, setQuery] = useState("");

  const { data, isLoading, isError } = useSearchableList({
    queryKeyBase: "event-settings",
    query,
    fetchAll: fetchEventSettingsList,
    filterClient: matches,
  });

  const prefetchRow = useListRowPrefetch((eventType: string) => ["event-settings", eventType], fetchEventSettings);

  return (
    <section className="list-page">
      <ListSearchInput value={query} onChange={setQuery} placeholder="Search events —" />

      <div className="border-t border-dust">
        {isLoading && <ListLoadingState />}
        {isError && <ListErrorState label="Event settings" />}
        {!isLoading && !isError && data?.length === 0 && <ListEmptyState label="event types" hasQuery={!!query} />}
        {!isLoading &&
          !isError &&
          data?.map((row) => (
            <button
              type="button"
              key={row.eventType}
              onClick={() => onOpen(row.eventType)}
              onMouseEnter={() => prefetchRow(row.eventType)}
              onFocus={() => prefetchRow(row.eventType)}
              className="flex w-full items-baseline justify-between gap-2 border-b border-dust px-1 py-3 text-left hover:bg-ink/[0.03]"
            >
              <span className="flex min-w-0 items-center gap-2">
                {getChamberIcon(row.chamber, { className: "h-4 w-4 shrink-0 text-dust" })}
                <span className="truncate font-display text-lg text-ink">{row.label}</span>
              </span>
              <span className="shrink-0 font-mono text-xs text-dust">
                {[row.recordToHistory && "Recording", row.notify && "Notifying"].filter(Boolean).join(" · ") || "Off"}
              </span>
            </button>
          ))}
      </div>
    </section>
  );
}
