import { useQuery } from "@tanstack/react-query";
import { WidgetPreviewShell } from "@congress/exhibit-ui";
import { fetchOpenTasks } from "@/lib/api";

function formatDueDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function WidgetPreviewPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["tasks", "open"],
    queryFn: fetchOpenTasks,
  });

  return (
    <WidgetPreviewShell
      label="Open"
      addHref="/tasks/new"
      isLoading={isLoading}
      isError={isError}
      errorLabel="Tasks unavailable."
      isEmpty={(data?.length ?? 0) === 0}
      emptyLabel="— No open tasks —"
    >
      {data?.map((task) => (
        <a
          key={task.id}
          href={`/tasks/t/${task.id}`}
          target="_top"
          className="flex items-baseline justify-between gap-2 border-b border-dust py-1.5 font-display text-sm text-ink first:pt-0 last:border-b-0 hover:text-accent"
        >
          <span className="min-w-0 truncate">{task.name}</span>
          {task.dueDate && (
            <span className="shrink-0 font-mono text-xs text-dust">{formatDueDate(task.dueDate)}</span>
          )}
        </a>
      ))}
    </WidgetPreviewShell>
  );
}
