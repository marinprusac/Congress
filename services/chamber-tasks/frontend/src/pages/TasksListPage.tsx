import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useShellHosted, resolveChamberPath } from "@congress/exhibit-ui";
import { fetchTasks, fetchTask, searchTasks, setCompleted } from "@/lib/api";
import type { TaskSummary } from "@congress/shared-types";

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

  const { data, isLoading, isError } = useQuery({
    queryKey: query ? ["tasks", "search", query] : ["tasks"],
    queryFn: () => (query ? searchTasks(query) : fetchTasks()),
  });

  const completeMutation = useMutation({
    mutationFn: ({ id, completed }: { id: number; completed: boolean }) => setCompleted(id, completed),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["tasks", "open"] });
    },
  });

  const tasks = data ? sortOpenFirst(data) : data;

  function prefetchTask(id: number) {
    queryClient.prefetchQuery({ queryKey: ["task", id], queryFn: () => fetchTask(id) });
  }

  return (
    <section>
      <input
        type="search"
        placeholder="Search tasks —"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mb-6 w-full border border-dust bg-parchment px-3 py-2 font-mono text-base text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
      />

      <div className="border-t border-dust">
        {isLoading && <div className="px-1 py-3 font-mono text-sm text-dust">Loading —</div>}
        {isError && <div className="px-1 py-3 font-mono text-sm text-alert">Failed to reach the Tasks API.</div>}
        {!isLoading && !isError && tasks?.length === 0 && (
          <div className="border-b border-dust px-1 py-3 font-mono text-sm text-dust">
            — No tasks {query ? "match your search" : "yet"} —
          </div>
        )}
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
