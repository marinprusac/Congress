import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ExhibitTextarea,
  ExhibitActionBar,
  ExhibitAnnotatedText,
  ExhibitLinksLayout,
  navigateToExhibit,
  getChamberIcon,
  useShellHosted,
  resolveChamberPath,
  ConfirmSheet,
  showToast,
  fetchEventCatalog,
} from "@congress/congress-ui";
import { fetchDirective, updateDirective, deleteDirective, runDirective } from "@/lib/api";
import type { UpdateDirectiveRequest } from "../../../src/types";
import { ScheduleEditor, EMPTY_SCHEDULE, type ScheduleDraft } from "@/components/ScheduleEditor";
import { formatSchedule } from "@/lib/formatSchedule";

export function DirectiveViewPage() {
  const { id } = useParams<{ id: string }>();
  const directiveId = Number(id);
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draft, setDraft] = useState<UpdateDirectiveRequest>({});
  const [schedule, setSchedule] = useState<ScheduleDraft>(EMPTY_SCHEDULE);

  const directiveQuery = useQuery({
    queryKey: ["directive", directiveId],
    queryFn: () => fetchDirective(directiveId),
    enabled: Number.isInteger(directiveId),
  });

  const catalogQuery = useQuery({ queryKey: ["event-catalog"], queryFn: fetchEventCatalog, enabled: editing });

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

  useEffect(() => {
    if (directiveQuery.data && !editing) {
      const d = directiveQuery.data;
      setDraft({ title: d.title, body: d.body, enabled: d.enabled });
      setSchedule({
        scheduleType: d.scheduleType,
        intervalMs: d.intervalMs,
        scheduleHour: d.scheduleHour,
        scheduleMinute: d.scheduleMinute,
        scheduleDayOfWeek: d.scheduleDayOfWeek,
        scheduleTimeZone: d.scheduleTimeZone,
        triggerEventType: d.triggerEventType,
      });
    }
  }, [directiveQuery.data, editing]);

  if (!Number.isInteger(directiveId)) return <p className="font-mono text-sm text-alert">Invalid directive id.</p>;
  if (directiveQuery.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (directiveQuery.isError || !directiveQuery.data) return <p className="font-mono text-sm text-alert">Directive not found.</p>;

  const directive = directiveQuery.data;
  const scheduleLabel = formatSchedule(directive);

  function save() {
    updateMutation.mutate({ ...draft, ...schedule }, { onSuccess: () => setEditing(false) });
  }

  function toggleEnabled() {
    updateMutation.mutate({ enabled: !directive.enabled });
  }

  return (
    <article>
      <div className="mb-6 border-b border-dust pb-4">
        {editing ? (
          <input
            value={draft.title ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            className="w-full font-display text-3xl text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          />
        ) : (
          <>
            <h2 className="flex min-w-0 items-center gap-3 font-display text-3xl text-ink">
              <span className={directive.enabled ? "" : "text-dust line-through"}>{directive.title}</span>
            </h2>
            {scheduleLabel && <p className="mt-1 font-mono text-xs uppercase tracking-wide text-dust">{scheduleLabel}</p>}
          </>
        )}
      </div>

      {updateMutation.isError && <p className="mb-4 font-mono text-sm text-alert">{(updateMutation.error as Error).message}</p>}

      <ExhibitLinksLayout
        exhibitId={`directive-${directiveId}`}
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("deputy", r, navigate, shellHosted)}
        editable
        actions={
          <ExhibitActionBar>
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
                <button onClick={() => runMutation.mutate()} disabled={runMutation.isPending} className="tap-target text-accent hover:underline disabled:opacity-50">
                  {runMutation.isPending ? "Running —" : "Run now"}
                </button>
                <button onClick={toggleEnabled} className="tap-target text-accent hover:underline">
                  {directive.enabled ? "Disable" : "Enable"}
                </button>
                <button onClick={() => setEditing(true)} className="tap-target text-accent hover:underline">
                  Edit
                </button>
                <button onClick={() => setConfirmingDelete(true)} className="tap-target text-alert hover:underline">
                  Delete
                </button>
              </>
            )}
          </ExhibitActionBar>
        }
      >
        {editing ? (
          <>
            <ExhibitTextarea
              value={draft.body ?? ""}
              onChange={(value) => setDraft((d) => ({ ...d, body: value }))}
              rows={10}
              className="w-full border border-dust bg-parchment p-3 font-mono text-base text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
              renderIcon={(chamber) => getChamberIcon(chamber)}
            />
            <ScheduleEditor value={schedule} onChange={setSchedule} eventCatalog={catalogQuery.data ?? []} eventCatalogLoading={catalogQuery.isLoading} />
          </>
        ) : directive.body ? (
          <ExhibitAnnotatedText
            text={directive.body}
            renderIcon={(chamber) => getChamberIcon(chamber)}
            onNavigate={(r) => navigateToExhibit("deputy", r, navigate, shellHosted)}
            className="whitespace-pre-wrap text-base text-ink"
          />
        ) : (
          <p className="whitespace-pre-wrap text-base text-dust">— No instructions —</p>
        )}
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
