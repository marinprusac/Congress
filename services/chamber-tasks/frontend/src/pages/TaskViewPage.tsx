import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ExhibitFieldEditor,
  ExhibitActionBar,
  ExhibitLinksLayout,
  navigateToExhibit,
  getChamberIcon,
  useShellHosted,
  resolveChamberPath,
  ConfirmSheet,
  showToast,
} from "@congress/congress-ui";
import { fetchTask, updateTask, deleteTask, quickCreateTaskExhibit } from "@/lib/api";

function toDateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

export function TaskViewPage() {
  const { id } = useParams<{ id: string }>();
  const taskId = Number(id);
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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
      navigate(resolveChamberPath("/", "tasks", shellHosted));
      showToast("Task deleted");
    },
    onError: () => showToast("Failed to delete task.", "error"),
  });

  // Loads drafts exactly once per task, not on every background refetch -
  // the description is now always live (see below), so a resync gated on
  // `!editing` (editing only ever toggles name/due-date) would stomp
  // in-progress description edits made while `editing` is false.
  const initializedTaskIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (taskQuery.data && initializedTaskIdRef.current !== taskQuery.data.id) {
      setDraftName(taskQuery.data.name);
      setDraftDescription(taskQuery.data.description);
      setDraftDueDate(toDateInputValue(taskQuery.data.dueDate));
      initializedTaskIdRef.current = taskQuery.data.id;
    }
  }, [taskQuery.data]);

  if (!Number.isInteger(taskId)) return <p className="font-mono text-sm text-alert">Invalid task id.</p>;
  if (taskQuery.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (taskQuery.isError || !taskQuery.data) return <p className="font-mono text-sm text-alert">Task not found.</p>;

  const task = taskQuery.data;

  async function onCreateExhibit(title: string) {
    const result = await quickCreateTaskExhibit(title);
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    return result;
  }

  function save() {
    updateMutation.mutate(
      { name: draftName, description: draftDescription, dueDate: draftDueDate || null },
      { onSuccess: () => setEditing(false) }
    );
  }

  function cancel() {
    setEditing(false);
    setDraftName(task.name);
    setDraftDescription(task.description);
    setDraftDueDate(toDateInputValue(task.dueDate));
  }

  const descriptionDirty = draftDescription !== task.description;
  const showSaveControls = editing || descriptionDirty;

  return (
    <article>
      <div className="mb-6 border-b border-dust pb-4">
        {editing ? (
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            className="w-full font-display text-3xl text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          />
        ) : (
          <h2 className="flex min-w-0 items-center gap-3 font-display text-3xl text-ink">
            <span className={task.completed ? "line-through text-dust" : ""}>{task.name}</span>
          </h2>
        )}
      </div>

      {updateMutation.isError && (
        <p className="mb-4 font-mono text-sm text-alert">{(updateMutation.error as Error).message}</p>
      )}

      <div className="mb-6 flex flex-wrap gap-6">
        <div>
          <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">Due date</label>
          {editing ? (
            <input
              type="date"
              value={draftDueDate}
              onChange={(e) => setDraftDueDate(e.target.value)}
              className="border border-dust bg-parchment px-3 py-2 font-mono text-base text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
            />
          ) : (
            <p className="font-mono text-sm text-ink">
              {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "— None —"}
            </p>
          )}
        </div>
      </div>

      <ExhibitLinksLayout
        exhibitId={`task-${taskId}`}
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("tasks", r, navigate, shellHosted)}
        editable
        onCreateReference={onCreateExhibit}
        actions={
          <ExhibitActionBar>
            {showSaveControls ? (
              <>
                <button onClick={save} className="tap-target text-accent hover:underline">
                  Save
                </button>
                <button onClick={cancel} className="tap-target text-slate hover:underline">
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
                <button onClick={() => setEditing(true)} className="tap-target text-accent hover:underline">
                  Edit
                </button>
                <button
                  onClick={() => setConfirmingDelete(true)}
                  className="tap-target text-alert hover:underline"
                >
                  Delete
                </button>
              </>
            )}
          </ExhibitActionBar>
        }
      >
        <ExhibitFieldEditor
          value={draftDescription}
          onChange={setDraftDescription}
          minRows={12}
          placeholder="— No description —"
          className="w-full border border-dust bg-parchment p-3 font-mono text-base text-ink focus-within:outline-none"
          renderIcon={(chamber) => getChamberIcon(chamber)}
          onNavigate={(r) => navigateToExhibit("tasks", r, navigate, shellHosted)}
          onCreate={onCreateExhibit}
        />
      </ExhibitLinksLayout>
      <ConfirmSheet
        open={confirmingDelete}
        title="Delete task"
        message={`Delete "${task.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => {
          setConfirmingDelete(false);
          deleteMutation.mutate();
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </article>
  );
}
