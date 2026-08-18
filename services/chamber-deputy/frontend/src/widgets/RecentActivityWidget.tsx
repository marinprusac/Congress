import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { WidgetPreviewShell, useShellHosted, resolveChamberPath } from "@congress/congress-ui";
import { fetchRecentRuns } from "@/lib/api";

const TRIGGER_LABEL: Record<string, string> = { chat: "chat", periodic: "checkup", urgent: "urgent" };

// A lightweight "what has Deputy been doing" glance, reading the same
// deputy_runs audit log the full run history page shows in detail (docs/
// deputy-chamber-plan.md §12) - every run, not just ones that took action,
// so a string of "nothing to do" checkups is visible too.
export function RecentActivityWidget() {
  const shellHosted = useShellHosted();
  const { data, isLoading, isError } = useQuery({ queryKey: ["runs", "recent"], queryFn: fetchRecentRuns });

  return (
    <WidgetPreviewShell
      label="Recent Activity"
      addHref="/runs"
      addLabel="History →"
      ownChamber="deputy"
      isLoading={isLoading}
      isError={isError}
      errorLabel="Deputy unavailable."
      isEmpty={(data?.length ?? 0) === 0}
      emptyLabel="— No runs yet —"
    >
      {data?.map((run) => (
        <Link
          key={run.id}
          to={resolveChamberPath("/runs", "deputy", shellHosted)}
          className="flex items-baseline justify-between gap-2 border-b border-dust py-1.5 font-display text-sm text-ink first:pt-0 last:border-b-0 hover:text-accent"
        >
          <span className="min-w-0 truncate">{run.finalResponse || (run.ok ? "(no action taken)" : (run.errorMessage ?? "failed"))}</span>
          <span className={`shrink-0 font-mono text-xs ${run.ok ? "text-dust" : "text-alert"}`}>{TRIGGER_LABEL[run.trigger] ?? run.trigger}</span>
        </Link>
      ))}
    </WidgetPreviewShell>
  );
}
