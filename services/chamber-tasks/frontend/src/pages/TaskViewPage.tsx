import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExhibitSharingBadge, ExhibitLinksLayout, ShareControl, navigateToExhibit, getChamberIcon } from "@congress/exhibit-ui";
import { fetchTask, updateTask, deleteTask } from "@/lib/api";

function toDateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

export function TaskViewPage() {
  const { id } = useParams<{ id: string }>();
  const taskId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftDueDate, setDraftDueDate] = useState("");

  const taskQuery = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => fetchTask(taskId),
    enabled: Number.isInteger(taskId),
  });

  const updateMutation = useMutation({
    mutationFn: (input: { name: string; description: string; dueDate: string | null }) => updateTask(taskId, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(["task", taskId], updated);
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const completeMutation = useMutation({
    mutationFn: (completed: boolean) => updateTask(taskId, { completed }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["task", taskId], updated);
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTask(taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      navigate("/");
    },
  });

  useEffect(() => {
    if (taskQuery.data && !editing) {
      setDraftName(taskQuery.data.name);
      setDraftDescription(taskQuery.data.description);
      setDraftDueDate(toDateInputValue(taskQuery.data.dueDate));
    }
  }, [taskQuery.data, editing]);

  if (!Number.isInteger(taskId)) return <p className="font-mono text-sm text-alert">Invalid task id.</p>;
  if (taskQuery.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (taskQuery.isError || !taskQuery.data) return <p className="font-mono text-sm text-alert">Task not found.</p>;

  const task = taskQuery.data;

  function save() {
    updateMutation.mutate(
      { name: draftName, description: draftDescription, dueDate: draftDueDate || null },
      { onSuccess: () => setEditing(false) }
    );
  }

  return (
    <article>
      <div className="mb-6 flex flex-col gap-3 border-b border-dust pb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        {editing ? (
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            className="min-w-0 flex-1 font-display text-3xl text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          />
        ) : (
          <h2 className="flex min-w-0 flex-1 items-center gap-3 font-display text-3xl text-ink">
            <span className={task.completed ? "line-through text-dust" : ""}>{task.name}</span>
            <ExhibitSharingBadge exhibitId={`task-${taskId}`} className="exhibit-sharing-badge" />
          </h2>
        )}
        <div className="flex shrink-0 items-center gap-5 font-mono text-xs uppercase tracking-wide">
          {editing ? (
            <>
              <button onClick={save} className="tap-target text-accent hover:underline">
                Save
              </button>
              <button onClick={() => setEditing(false)} className="tap-target text-slate hover:underline">
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => completeMutation.mutate(!task.completed)}
                className="tap-target text-accent hover:underline"
              >
                {task.completed ? "Reopen" : "Complete"}
              </button>
              <ShareControl chamber="tasks" exhibitId={`task-${taskId}`} exhibitName={task.name} />
              <button onClick={() => setEditing(true)} className="tap-target text-accent hover:underline">
                Edit
              </button>
              <button
                onClick={() => {
                  if (confirm(`Delete "${task.name}"? This cannot be undone.`)) deleteMutation.mutate();
                }}
                className="tap-target text-alert hover:underline"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      {updateMutation.isError && (
        <p className="mb-4 font-mono text-sm text-alert">{(updateMutation.error as Error).message}</p>
      )}

      <div className="mb-6">
        <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">Due date</label>
        {editing ? (
          <input
            type="date"
            value={draftDueDate}
            onChange={(e) => setDraftDueDate(e.target.value)}
            className="border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          />
        ) : (
          <p className="font-mono text-sm text-ink">
            {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "— None —"}
          </p>
        )}
      </div>

      <ExhibitLinksLayout
        exhibitId={`task-${taskId}`}
        emptyBacklinksLabel="Nothing references this task"
        emptyFrontlinksLabel="This task references nothing"
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("tasks", r, navigate)}
      >
        {editing ? (
          <textarea
            value={draftDescription}
            onChange={(e) => setDraftDescription(e.target.value)}
            rows={12}
            className="w-full border border-dust bg-parchment p-3 font-mono text-base text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          />
        ) : (
          <p className="whitespace-pre-wrap text-base text-ink">
            {task.description || <span className="text-dust">— No description —</span>}
          </p>
        )}
      </ExhibitLinksLayout>
    </article>
  );
}
