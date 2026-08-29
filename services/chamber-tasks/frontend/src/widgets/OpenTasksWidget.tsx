import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { WidgetPreviewShell, useShellHosted, resolveChamberPath } from "@congress/congress-ui";
import { fetchOpenTasks } from "@/lib/api";

function formatDueDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function OpenTasksWidget() {
  const shellHosted = useShellHosted();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["tasks", "open"],
    queryFn: fetchOpenTasks,
  });

  return (
    <WidgetPreviewShell
      label="Open"
      addHref="/new"
      ownChamber="tasks"
      isLoading={isLoading}
      isError={isError}
      errorLabel="Tasks unavailable."
      isEmpty={(data?.length ?? 0) === 0}
      emptyLabel="— No open tasks —"
    >
      {data?.map((task) => (
        <Link
          key={task.id}
          to={resolveChamberPath(`/t/${task.id}`, "tasks", shellHosted)}
          className="flex items-baseline justify-between gap-2 border-b border-dust py-1.5 font-display text-sm text-ink first:pt-0 last:border-b-0 hover:text-accent"
        >
          <span className="min-w-0 truncate">{task.name}</span>
          <span className="flex shrink-0 items-baseline gap-2">
            {task.dueDate && <span className="font-mono text-xs text-dust">{formatDueDate(task.dueDate)}</span>}
          </span>
        </Link>
      ))}
    </WidgetPreviewShell>
  );
}
