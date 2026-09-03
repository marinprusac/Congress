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
  useAutosave,
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
  // otherwise a resync would stomp in-progress edits.
  const initializedTaskIdRef = useRef<number | null>(null);
  const { markSaved } = useAutosave({
    value: { name: draftName, description: draftDescription, dueDate: draftDueDate || null },
    enabled: initializedTaskIdRef.current !== null,
    onSave: (draft) => updateMutation.mutate(draft),
  });
  useEffect(() => {
    if (taskQuery.data && initializedTaskIdRef.current !== taskQuery.data.id) {
      const draft = {
        name: taskQuery.data.name,
        description: taskQuery.data.description,
        dueDate: toDateInputValue(taskQuery.data.dueDate) || null,
      };
      setDraftName(draft.name);
      setDraftDescription(draft.description);
      setDraftDueDate(draft.dueDate ?? "");
      markSaved(draft);
      initializedTaskIdRef.current = taskQuery.data.id;
    }
  }, [taskQuery.data, markSaved]);

  if (!Number.isInteger(taskId)) return <p className="font-mono text-sm text-alert">Invalid task id.</p>;
  if (taskQuery.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (taskQuery.isError || !taskQuery.data) return <p className="font-mono text-sm text-alert">Task not found.</p>;

  const task = taskQuery.data;

  async function onCreateExhibit(title: string) {
    const result = await quickCreateTaskExhibit(title);
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    return result;
  }

  return (
    <article>
      <div className="mb-6 border-b border-dust pb-4">
        <input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          placeholder="Untitled"
          className={`w-full font-display text-3xl placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent ${task.completed ? "line-through text-dust" : "text-ink"}`}
        />
      </div>

      {updateMutation.isError && (
        <p className="mb-4 font-mono text-sm text-alert">{(updateMutation.error as Error).message}</p>
      )}

      <div className="mb-6 flex flex-wrap gap-6">
        <div>
          <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">Due date</label>
          <input
            type="date"
            value={draftDueDate}
            onChange={(e) => setDraftDueDate(e.target.value)}
            className="border border-dust bg-parchment px-3 py-2 font-mono text-base text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          />
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
            <button
              onClick={() => completeMutation.mutate(!task.completed)}
              className="tap-target text-accent hover:underline"
            >
              {task.completed ? "Reopen" : "Complete"}
            </button>
            <button onClick={() => setConfirmingDelete(true)} className="tap-target text-alert hover:underline">
              Delete
            </button>
          </ExhibitActionBar>
        }
      >
        <ExhibitFieldEditor
          value={draftDescription}
          onChange={setDraftDescription}
          minRows={12}
          placeholder="— No description —"
          className="w-full bg-parchment p-3 font-body text-base text-ink focus-within:outline-none"
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
