import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { WidgetPreviewShell, useShellHosted, resolveChamberPath } from "@congress/congress-ui";
import { fetchRecentAutomations } from "@/lib/api";

export function RecentAutomationsWidget() {
  const shellHosted = useShellHosted();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["automations", "recent"],
    queryFn: fetchRecentAutomations,
  });

  return (
    <WidgetPreviewShell
      label="Recent"
      addHref="/new"
      ownChamber="notifications"
      isLoading={isLoading}
      isError={isError}
      errorLabel="Automations unavailable."
      isEmpty={(data?.length ?? 0) === 0}
      emptyLabel="— No automations yet —"
    >
      {data?.map((automation) => (
        <Link
          key={automation.id}
          to={resolveChamberPath(`/a/${automation.id}`, "notifications", shellHosted)}
          className="flex items-baseline justify-between gap-2 border-b border-dust py-1.5 font-display text-sm text-ink first:pt-0 last:border-b-0 hover:text-accent"
        >
          <span className="min-w-0 truncate">{automation.title}</span>
          {!automation.enabled && <span className="shrink-0 font-mono text-xs text-dust">disabled</span>}
        </Link>
      ))}
    </WidgetPreviewShell>
  );
}
