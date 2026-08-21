import { useQuery } from "@tanstack/react-query";
import { WidgetPreviewShell } from "@congress/congress-ui";
import { fetchVisits } from "@/lib/api";

function todayIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

export function RecentVisitsWidget() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["visits", "recent-widget"],
    queryFn: () => fetchVisits({ from: todayIso() }),
  });

  const visits = (data ?? []).filter((v) => v.status === "confirmed" || v.status === "adhoc");

  return (
    <WidgetPreviewShell
      label="Recent Visits"
      addHref="/places/new"
      ownChamber="map"
      isLoading={isLoading}
      isError={isError}
      errorLabel="Map unavailable."
      isEmpty={visits.length === 0}
      emptyLabel="— No visits today yet —"
    >
      {visits.map((v) => (
        <div key={v.id} className="flex items-baseline justify-between gap-2 border-b border-dust py-1.5 font-display text-sm text-ink first:pt-0 last:border-b-0">
          <span className="min-w-0 truncate">{v.placeName ?? v.adhocLabel ?? "Unclassified location"}</span>
          <span className="shrink-0 font-mono text-xs text-dust">
            {new Date(v.arrivedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      ))}
    </WidgetPreviewShell>
  );
}
