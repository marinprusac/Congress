import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { fetchTasks, fetchTask, searchTasks, setCompleted } from "@/lib/api";
import type { TaskSummary } from "../../../src/types";

function formatDueDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function sortOpenFirst(tasks: TaskSummary[]): TaskSummary[] {
  return [...tasks].sort((a, b) => Number(a.completed) - Number(b.completed));
}

export function TasksListPage() {
  const [query, setQuery] = useState("");
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useSearchableList({
    queryKeyBase: "tasks",
    query,
    fetchAll: fetchTasks,
    fetchSearch: searchTasks,
  });

  const completeMutation = useMutation({
    mutationFn: ({ id, completed }: { id: number; completed: boolean }) => setCompleted(id, completed),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["tasks", "open"] });
    },
  });

  const tasks = data ? sortOpenFirst(data) : data;

  const prefetchTask = useListRowPrefetch((id: number) => ["task", id], fetchTask);

  return (
    <section>
      <ListSearchInput value={query} onChange={setQuery} placeholder="Search tasks —" />

      <div className="border-t border-dust">
        {isLoading && <ListLoadingState />}
        {isError && <ListErrorState label="Tasks" />}
        {!isLoading && !isError && tasks?.length === 0 && <ListEmptyState label="tasks" hasQuery={!!query} />}
        {!isLoading &&
          !isError &&
          tasks?.map((task) => (
            <div key={task.id} className="flex items-baseline gap-3 border-b border-dust px-1 py-3">
              <button
                type="button"
                onClick={() => completeMutation.mutate({ id: task.id, completed: !task.completed })}
                className="tap-target shrink-0 font-mono text-xs uppercase tracking-wide text-dust hover:text-accent"
              >
                {task.completed ? "Reopen" : "Done"}
              </button>
              <Link
                to={resolveChamberPath(`/t/${task.id}`, "tasks", shellHosted)}
                onMouseEnter={() => prefetchTask(task.id)}
                onFocus={() => prefetchTask(task.id)}
                className="min-w-0 flex-1 hover:bg-ink/[0.03]"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className={task.completed ? "font-display text-lg text-dust line-through" : "font-display text-lg text-ink"}>
                    {task.name}
                  </span>
                  {task.dueDate && (
                    <span className="shrink-0 font-mono text-xs text-dust">{formatDueDate(task.dueDate)}</span>
                  )}
                </div>
                {task.description && <p className="mt-1 text-sm text-slate">{task.description}</p>}
              </Link>
            </div>
          ))}
      </div>
    </section>
  );
}
