import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useState, type ReactNode } from "react";
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
import { sortTasks, groupByDueCategory } from "@/lib/taskSort";
import type { TaskSummary } from "../../../src/types";

function formatDueDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const dueGroupStyles = {
  overdue: { border: "border-alert", text: "text-alert", label: "Overdue" },
  today: { border: "border-accent", text: "text-accent", label: "Due today" },
  soon: { border: "border-slate", text: "text-slate", label: "Due soon" },
} as const;

function DueGroupBox({ category, children }: { category: "overdue" | "today" | "soon"; children: ReactNode }) {
  const style = dueGroupStyles[category];
  return (
    <div className={`relative mt-6 mb-2 border px-2 pb-1 ${style.border}`}>
      <span className={`absolute left-2 top-0 -translate-y-1/2 bg-parchment px-2 font-mono text-xs uppercase tracking-wide ${style.text}`}>
        {style.label}
      </span>
      {children}
    </div>
  );
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

  const tasks = data ? sortTasks(data) : data;
  const blocks = tasks ? groupByDueCategory(tasks) : [];
  const firstCompletedId = tasks?.find((task) => task.completed)?.id ?? null;

  const prefetchTask = useListRowPrefetch((id: number) => ["task", id], fetchTask);

  function renderTaskRow(task: TaskSummary) {
    const addMarginTop = task.completed && task.id === firstCompletedId;
    return (
      <div
        key={task.id}
        className={addMarginTop ? "flex items-center gap-3 px-1 py-3 mt-8" : "flex items-center gap-3 px-1 py-3"}
      >
        <label className="tap-target shrink-0">
          <input
            type="checkbox"
            checked={task.completed}
            onChange={(e) => completeMutation.mutate({ id: task.id, completed: e.target.checked })}
            aria-label={task.completed ? "Reopen task" : "Mark task done"}
            className="checkbox"
          />
        </label>
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
            <span className="flex shrink-0 items-baseline gap-2">
              {task.dueDate && <span className="font-mono text-xs text-dust">{formatDueDate(task.dueDate)}</span>}
            </span>
          </div>
          {task.description && <p className="mt-1 text-sm text-slate">{task.description}</p>}
        </Link>
      </div>
    );
  }

  return (
    <section className="list-page">
      <ListSearchInput
        value={query}
        onChange={setQuery}
        placeholder="Search tasks —"
        newHref={resolveChamberPath("/new", "tasks", shellHosted)}
      />

      {isLoading && <ListLoadingState />}
      {isError && <ListErrorState label="Tasks" />}
      {!isLoading && !isError && tasks?.length === 0 && <ListEmptyState label="tasks" hasQuery={!!query} />}
      {!isLoading &&
        !isError &&
        blocks.map((block) =>
          block.kind === "group" ? (
            <DueGroupBox key={`${block.category}-${block.tasks[0]!.id}`} category={block.category}>
              {block.tasks.map(renderTaskRow)}
            </DueGroupBox>
          ) : (
            renderTaskRow(block.task)
          ),
        )}
    </section>
  );
}
