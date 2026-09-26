import { useQuery } from "@tanstack/react-query";
import { ViewCard } from "@congress/congress-ui";
import { fetchVisits } from "@/lib/api";

// Home feed card for the "Visits to classify" view - stays that the owner
// hasn't said where they were yet (the full-screen view is /pending).
export function PendingVisitsWidget() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["visits", "pending-widget"],
    queryFn: () => fetchVisits({ status: "pending" }),
  });

  const visits = data ?? [];

  return (
    <ViewCard
      isLoading={isLoading}
      isError={isError}
      errorLabel="Map unavailable."
      isEmpty={visits.length === 0}
      emptyLabel="— Nothing to classify —"
    >
      {visits.slice(0, 5).map((v) => (
        <div key={v.id} className="flex items-baseline justify-between gap-2 border-b border-dust py-1.5 font-display text-sm text-ink first:pt-0 last:border-b-0">
          <span className="min-w-0 truncate">Unclassified stay</span>
          <span className="shrink-0 font-mono text-xs text-dust">
            {new Date(v.arrivedAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      ))}
    </ViewCard>
  );
}
