import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { WidgetPreviewShell, useShellHosted, resolveChamberPath, getChamberIcon } from "@congress/congress-ui";
import type { PriorityLevel } from "@congress/shared-types";
import { fetchHistory } from "@/lib/api";

// Shared by RecentLogsWidget (unfiltered) and UrgentLogsWidget (a fixed
// priority >= high query filter) - the two declared widgets from a
// "declare N fixed widgets, the owner places what they want" approach
// rather than building general per-widget configuration into Capitol's
// canvas (which has none today) just for this one filter. Each history
// entry links to the event type's own settings page, not a page of its
// own - history rows aren't independently addressable Exhibits.
export function HistoryFeed({ label, minPriority, emptyLabel }: { label: string; minPriority?: PriorityLevel; emptyLabel: string }) {
  const shellHosted = useShellHosted();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["history", minPriority ?? "all"],
    queryFn: () => fetchHistory({ minPriority, limit: 10 }),
  });

  return (
    <WidgetPreviewShell
      label={label}
      addHref="/"
      addLabel="View all"
      ownChamber="logs"
      isLoading={isLoading}
      isError={isError}
      errorLabel="History unavailable."
      isEmpty={(data?.length ?? 0) === 0}
      emptyLabel={emptyLabel}
    >
      {data?.map((entry) => (
        <Link
          key={entry.id}
          to={resolveChamberPath(`/events/${encodeURIComponent(entry.type)}`, "logs", shellHosted)}
          className="flex items-baseline gap-2 border-b border-dust py-1.5 font-display text-sm text-ink first:pt-0 last:border-b-0 hover:text-accent"
        >
          {getChamberIcon(entry.chamber, { className: "h-4 w-4 shrink-0 text-dust" })}
          <span className="min-w-0 truncate">{entry.label}</span>
        </Link>
      ))}
    </WidgetPreviewShell>
  );
}
