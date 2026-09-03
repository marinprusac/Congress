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
  fetchEventCatalog,
  useAutosave,
} from "@congress/congress-ui";
import { fetchDirective, updateDirective, deleteDirective, runDirective } from "@/lib/api";
import type { UpdateDirectiveRequest } from "../../../src/types";
import { ScheduleEditor, EMPTY_SCHEDULE, type ScheduleDraft } from "@/components/ScheduleEditor";

export function DirectiveViewPage() {
  const { id } = useParams<{ id: string }>();
  const directiveId = Number(id);
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draft, setDraft] = useState<UpdateDirectiveRequest>({});
  const [schedule, setSchedule] = useState<ScheduleDraft>(EMPTY_SCHEDULE);

  const directiveQuery = useQuery({
    queryKey: ["directive", directiveId],
    queryFn: () => fetchDirective(directiveId),
    enabled: Number.isInteger(directiveId),
  });

  const catalogQuery = useQuery({ queryKey: ["event-catalog"], queryFn: fetchEventCatalog });

  const updateMutation = useMutation({
    mutationFn: (input: UpdateDirectiveRequest) => updateDirective(directiveId, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(["directive", directiveId], updated);
      queryClient.invalidateQueries({ queryKey: ["directives"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteDirective(directiveId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["directives"] });
      navigate(resolveChamberPath("/", "deputy", shellHosted));
      showToast("Directive deleted");
    },
    onError: () => showToast("Failed to delete directive.", "error"),
  });

  const runMutation = useMutation({
    mutationFn: () => runDirective(directiveId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["directive", directiveId] });
      showToast(result.ok ? "Directive run complete" : (result.errorMessage ?? "Directive run failed."), result.ok ? "success" : "error");
    },
    onError: () => showToast("Failed to run directive.", "error"),
  });

  // Loads exactly once per directive, not on every background refetch -
  // otherwise a resync would stomp in-progress edits.
  const initializedDirectiveIdRef = useRef<number | null>(null);
  const { markSaved } = useAutosave({
    value: { ...draft, ...schedule },
    enabled: initializedDirectiveIdRef.current !== null,
    onSave: (merged) => updateMutation.mutate(merged),
  });
  useEffect(() => {
    if (directiveQuery.data && initializedDirectiveIdRef.current !== directiveQuery.data.id) {
      const d = directiveQuery.data;
      const loadedDraft: UpdateDirectiveRequest = { title: d.title, body: d.body, enabled: d.enabled };
      const loadedSchedule: ScheduleDraft = {
        scheduleType: d.scheduleType,
        intervalMs: d.intervalMs,
        scheduleHour: d.scheduleHour,
        scheduleMinute: d.scheduleMinute,
        scheduleDayOfWeek: d.scheduleDayOfWeek,
        scheduleTimeZone: d.scheduleTimeZone,
        triggerEventType: d.triggerEventType,
      };
      setDraft(loadedDraft);
      setSchedule(loadedSchedule);
      markSaved({ ...loadedDraft, ...loadedSchedule });
      initializedDirectiveIdRef.current = d.id;
    }
  }, [directiveQuery.data, markSaved]);

  if (!Number.isInteger(directiveId)) return <p className="font-mono text-sm text-alert">Invalid directive id.</p>;
  if (directiveQuery.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (directiveQuery.isError || !directiveQuery.data) return <p className="font-mono text-sm text-alert">Directive not found.</p>;

  const directive = directiveQuery.data;

  // Bypasses the debounce for an instant flip (the button's label/strike-
  // through reads from `directive.enabled`, not `draft.enabled`, so a
  // debounced round-trip would leave it momentarily lying about the current
  // state). Folds the toggle into `draft` and marks the merged value saved
  // so a debounce already pending from an unrelated field edit can't re-
  // send a stale `enabled` value moments later and flip it back.
  function toggleEnabled() {
    const nextDraft: UpdateDirectiveRequest = { ...draft, enabled: !directive.enabled };
    setDraft(nextDraft);
    markSaved({ ...nextDraft, ...schedule });
    updateMutation.mutate({ ...nextDraft, ...schedule });
  }

  return (
    <article>
      <div className="mb-6 border-b border-dust pb-4">
        <input
          value={draft.title ?? ""}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          placeholder="Untitled"
          className={`w-full font-display text-3xl placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent ${directive.enabled ? "text-ink" : "text-dust line-through"}`}
        />
      </div>

      {updateMutation.isError && <p className="mb-4 font-mono text-sm text-alert">{(updateMutation.error as Error).message}</p>}

      <ExhibitLinksLayout
        exhibitId={`directive-${directiveId}`}
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("deputy", r, navigate, shellHosted)}
        editable
        actions={
          <ExhibitActionBar>
            <button onClick={() => runMutation.mutate()} disabled={runMutation.isPending} className="tap-target text-accent hover:underline disabled:opacity-50">
              {runMutation.isPending ? "Running —" : "Run now"}
            </button>
            <button onClick={toggleEnabled} className="tap-target text-accent hover:underline">
              {directive.enabled ? "Disable" : "Enable"}
            </button>
            <button onClick={() => setConfirmingDelete(true)} className="tap-target text-alert hover:underline">
              Delete
            </button>
          </ExhibitActionBar>
        }
      >
        <ExhibitFieldEditor
          value={draft.body ?? ""}
          onChange={(value) => setDraft((d) => ({ ...d, body: value }))}
          minRows={10}
          placeholder="— No instructions —"
          className="w-full bg-parchment p-3 font-body text-base text-ink focus-within:outline-none"
          renderIcon={(chamber) => getChamberIcon(chamber)}
          onNavigate={(r) => navigateToExhibit("deputy", r, navigate, shellHosted)}
        />
        <ScheduleEditor value={schedule} onChange={setSchedule} eventCatalog={catalogQuery.data ?? []} eventCatalogLoading={catalogQuery.isLoading} />
      </ExhibitLinksLayout>

      <ConfirmSheet
        open={confirmingDelete}
        title="Delete directive"
        message={`Delete "${directive.title}"? This cannot be undone.`}
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
