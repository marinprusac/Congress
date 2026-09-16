import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ExhibitFieldEditor,
  ExhibitActionBar,
  ExhibitLinksLayout,
  navigateToExhibit,
  getChamberIcon,
  useShellHosted,
  resolveChamberPath,
  flushDraftConnections,
  ConfirmSheet,
  showToast,
  useAutosave,
  useDraftCreate,
  resolveEditorIdentity,
} from "@congress/congress-ui";
import type { CapitolExhibitSearchResult } from "@congress/shared-types";
import { createTask, fetchTask, updateTask, deleteTask, quickCreateTaskExhibit } from "@/lib/api";
import { dateInputToIso, isoToDateInput } from "@/lib/dateInput";

function toDateInputValue(iso: string | null): string {
  return iso ? isoToDateInput(iso) : "";
}

function parseTaskId(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

// Handles both "create" (route `/new`, no `:id`) and "edit" (route
// `/t/:id`) as one mounted component - see chamber-notes' NoteEditorPage,
// which this mirrors, for the full reasoning behind merging the two.
export function TaskEditorPage() {
  const { id: idParam } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();

  const [taskId, setTaskId] = useState<number | null>(() => parseTaskId(idParam));
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draftName, setDraftName] = useState(searchParams.get("name") ?? "");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftDueDate, setDraftDueDate] = useState("");
  const [draftConnections, setDraftConnections] = useState<CapitolExhibitSearchResult[]>([]);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  const taskQuery = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => fetchTask(taskId as number),
    enabled: taskId !== null,
  });

  const createMutation = useMutation({
    mutationFn: async (draft: { name: string; description: string; dueDate: string | null }) => {
      const created = await createTask({
        name: draft.name,
        description: draft.description,
        dueDate: draft.dueDate ? dateInputToIso(draft.dueDate) : null,
      });
      await flushDraftConnections(`task-${created.id}`, draftConnections);
      return created;
    },
    onSuccess: (created, draft) => {
      queryClient.setQueryData(["task", created.id], created);
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      if (taskId !== null) return;
      initializedTaskIdRef.current = created.id;
      markSaved(draft);
      setTaskId(created.id);
      navigate(resolveChamberPath(`/t/${created.id}`, "tasks", shellHosted), { replace: true });
    },
    onError: () => {
      draftCreate.reset();
      showToast("Failed to create task.", "error");
    },
  });

  // Fires on the name field's blur (see the input's onBlur below) rather
  // than a content-change debounce - see useDraftCreate's own comment.
  const draftCreate = useDraftCreate({
    value: { name: draftName, description: draftDescription, dueDate: draftDueDate || null },
    canCreate: (v) => taskId === null && v.name.trim().length > 0,
    onCreate: (draft) => createMutation.mutate(draft),
  });

  // A navigation between two different ids, or back to the draft/"new"
  // route, reuses this same mounted component - see resolveEditorIdentity's
  // own comment.
  useEffect(() => {
    const fromUrl = parseTaskId(idParam);
    if (resolveEditorIdentity(fromUrl, taskId) === "keep") return;
    draftCreate.attempt();
    setTaskId(fromUrl);
    setDraftName("");
    setDraftDescription("");
    setDraftDueDate("");
    setDraftConnections([]);
    initializedTaskIdRef.current = null;
    draftCreate.reset();
    if (fromUrl === null) nameInputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idParam, taskId]);

  const updateMutation = useMutation({
    mutationFn: (input: { name: string; description: string; dueDate: string | null }) =>
      updateTask(taskId as number, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(["task", taskId], updated);
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const completeMutation = useMutation({
    mutationFn: (completed: boolean) => updateTask(taskId as number, { completed }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["task", taskId], updated);
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTask(taskId as number),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      navigate(resolveChamberPath("/", "tasks", shellHosted));
      showToast("Task deleted");
    },
    onError: () => showToast("Failed to delete task.", "error"),
  });

  // Loads drafts exactly once per task, not on every background refetch -
  // otherwise a resync would stomp in-progress edits. Also covers the
  // just-created task: its query is pre-seeded via setQueryData above, so
  // this effect's `markSaved` runs immediately without feeding a stale/
  // empty server value back into the editor.
  const initializedTaskIdRef = useRef<number | null>(null);
  const { markSaved } = useAutosave({
    value: { name: draftName, description: draftDescription, dueDate: draftDueDate || null },
    enabled: taskId !== null && initializedTaskIdRef.current === taskId,
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

  async function onCreateExhibit(title: string) {
    const result = await quickCreateTaskExhibit(title);
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    return result;
  }

  const isDraft = taskId === null;
  if (!isDraft && taskQuery.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (!isDraft && (taskQuery.isError || !taskQuery.data))
    return <p className="font-mono text-sm text-alert">Task not found.</p>;

  const task = isDraft ? null : taskQuery.data ?? null;

  return (
    <article>
      <div className="mb-6 border-b border-dust pb-4">
        <input
          ref={nameInputRef}
          autoFocus={isDraft}
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={() => draftCreate.attempt()}
          placeholder={isDraft ? "Name" : "Untitled"}
          className={`w-full font-display text-3xl placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent ${task?.completed ? "line-through text-dust" : "text-ink"}`}
        />
      </div>

      {createMutation.isError && (
        <p className="mb-4 font-mono text-sm text-alert">{(createMutation.error as Error).message}</p>
      )}
      {updateMutation.isError && (
        <p className="mb-4 font-mono text-sm text-alert">{(updateMutation.error as Error).message}</p>
      )}

      <div className="mb-6 flex flex-wrap gap-6">
        <div>
          <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">
            Due date{isDraft ? " (optional)" : ""}
          </label>
          <input
            type="date"
            value={draftDueDate}
            onChange={(e) => setDraftDueDate(e.target.value)}
            className={isDraft ? "border border-dust bg-parchment px-3 py-2 font-mono text-base text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent" : "field-plain font-mono text-base"}
          />
        </div>
      </div>

      <ExhibitLinksLayout
        exhibitId={isDraft ? null : `task-${taskId}`}
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("tasks", r, navigate, shellHosted)}
        editable
        onCreateReference={onCreateExhibit}
        draftConnections={draftConnections}
        onDraftConnectionsChange={setDraftConnections}
        actions={
          <ExhibitActionBar>
            {isDraft ? (
              <button
                onClick={() => navigate(resolveChamberPath("/", "tasks", shellHosted))}
                className="tap-target text-slate hover:underline"
              >
                Cancel
              </button>
            ) : (
              <>
                <button
                  onClick={() => completeMutation.mutate(!task?.completed)}
                  className="tap-target text-accent hover:underline"
                >
                  {task?.completed ? "Reopen" : "Complete"}
                </button>
                <button onClick={() => setConfirmingDelete(true)} className="tap-target text-alert hover:underline">
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
          minRows={3}
          placeholder={isDraft ? "Description (optional), @ to reference an Exhibit" : "— No description —"}
          className="w-full bg-parchment p-3 font-body text-base text-ink focus-within:outline-none"
          renderIcon={(chamber) => getChamberIcon(chamber)}
          onNavigate={(r) => navigateToExhibit("tasks", r, navigate, shellHosted)}
          onCreate={onCreateExhibit}
        />
      </ExhibitLinksLayout>
      {!isDraft && (
        <ConfirmSheet
          open={confirmingDelete}
          title="Delete task"
          message={`Delete "${task?.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => {
            setConfirmingDelete(false);
            deleteMutation.mutate();
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </article>
  );
}
