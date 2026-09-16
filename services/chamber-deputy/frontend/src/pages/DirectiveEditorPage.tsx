import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
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
  fetchEventCatalog,
  useAutosave,
  useDraftCreate,
  resolveEditorIdentity,
} from "@congress/congress-ui";
import type { CapitolExhibitSearchResult } from "@congress/shared-types";
import { createDirective, fetchDirective, updateDirective, deleteDirective, runDirective, fetchSettings } from "@/lib/api";
import { useDeputyRunStream } from "@/lib/useDeputyRunStream";
import type { UpdateDirectiveRequest } from "../../../src/types";
import { ScheduleEditor, EMPTY_SCHEDULE, type ScheduleDraft } from "@/components/ScheduleEditor";

function parseDirectiveId(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

// Handles both "create" (route `/directives/new`, no `:id`) and "edit"
// (route `/d/:id`) as one mounted component - see chamber-notes'
// NoteEditorPage, which this mirrors, for the full reasoning behind
// merging the two.
export function DirectiveEditorPage() {
  const { id: idParam } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();
  const runStream = useDeputyRunStream();

  const [directiveId, setDirectiveId] = useState<number | null>(() => parseDirectiveId(idParam));
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draft, setDraft] = useState<UpdateDirectiveRequest>({ title: searchParams.get("name") ?? "", body: "" });
  const [schedule, setSchedule] = useState<ScheduleDraft>(EMPTY_SCHEDULE);
  const [draftConnections, setDraftConnections] = useState<CapitolExhibitSearchResult[]>([]);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  // See DirectivesListPage's own comment on this same query - a paused
  // Deputy (budget cap or owner-paused) makes "Run now" return instantly
  // with ok:false, which without this reads as the button just doing
  // nothing rather than Deputy having declined to run.
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const paused = settingsQuery.data?.paused ?? false;

  const directiveQuery = useQuery({
    queryKey: ["directive", directiveId],
    queryFn: () => fetchDirective(directiveId as number),
    enabled: directiveId !== null,
  });

  const catalogQuery = useQuery({ queryKey: ["event-catalog"], queryFn: fetchEventCatalog });

  const createMutation = useMutation({
    mutationFn: async (merged: UpdateDirectiveRequest & ScheduleDraft) => {
      // Reads schedule fields off `merged` (the value useDraftCreate/
      // draftCreate.attempt() actually captured), not the `schedule` state
      // variable directly - the identity-reset effect that can trigger this
      // clears `schedule` back to EMPTY_SCHEDULE on the very next line
      // after calling attempt(), so closing over it here would race.
      const created = await createDirective({
        title: merged.title ?? "",
        body: merged.body ?? "",
        enabled: true,
        scheduleType: merged.scheduleType,
        intervalMs: merged.intervalMs,
        scheduleHour: merged.scheduleHour,
        scheduleMinute: merged.scheduleMinute,
        scheduleDayOfWeek: merged.scheduleDayOfWeek,
        scheduleTimeZone: merged.scheduleTimeZone,
        triggerEventType: merged.triggerEventType,
      });
      await flushDraftConnections(`directive-${created.id}`, draftConnections);
      return created;
    },
    onSuccess: (created, merged) => {
      queryClient.setQueryData(["directive", created.id], created);
      queryClient.invalidateQueries({ queryKey: ["directives"] });
      if (directiveId !== null) return;
      initializedDirectiveIdRef.current = created.id;
      markSaved(merged);
      setDirectiveId(created.id);
      navigate(resolveChamberPath(`/d/${created.id}`, "deputy", shellHosted), { replace: true });
    },
    onError: () => {
      draftCreate.reset();
      showToast("Failed to create directive.", "error");
    },
  });

  // Fires on the title field's blur (see the input's onBlur below) rather
  // than a content-change debounce - see useDraftCreate's own comment.
  const draftCreate = useDraftCreate({
    value: { ...draft, ...schedule },
    canCreate: (v) => directiveId === null && (v.title ?? "").trim().length > 0,
    onCreate: (merged) => createMutation.mutate(merged),
  });

  // A navigation between two different ids, or back to the draft/"new"
  // route, reuses this same mounted component - see resolveEditorIdentity's
  // own comment.
  useEffect(() => {
    const fromUrl = parseDirectiveId(idParam);
    if (resolveEditorIdentity(fromUrl, directiveId) === "keep") return;
    draftCreate.attempt();
    setDirectiveId(fromUrl);
    setDraft({ title: "", body: "" });
    setSchedule(EMPTY_SCHEDULE);
    setDraftConnections([]);
    initializedDirectiveIdRef.current = null;
    draftCreate.reset();
    if (fromUrl === null) titleInputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idParam, directiveId]);

  const updateMutation = useMutation({
    mutationFn: (input: UpdateDirectiveRequest) => updateDirective(directiveId as number, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(["directive", directiveId], updated);
      queryClient.invalidateQueries({ queryKey: ["directives"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteDirective(directiveId as number),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["directives"] });
      navigate(resolveChamberPath("/", "deputy", shellHosted));
      showToast("Directive deleted");
    },
    onError: () => showToast("Failed to delete directive.", "error"),
  });

  const runMutation = useMutation({
    mutationFn: () => runDirective(directiveId as number),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["directive", directiveId] });
      showToast(result.ok ? "Directive run complete" : (result.errorMessage ?? "Directive run failed."), result.ok ? "success" : "error");
    },
    onError: () => showToast("Failed to run directive.", "error"),
  });

  // Loads exactly once per directive, not on every background refetch -
  // otherwise a resync would stomp in-progress edits. Also covers the
  // just-created directive: its query is pre-seeded via setQueryData above,
  // so this effect's `markSaved` runs immediately without feeding a stale/
  // empty server value back into the editor.
  const initializedDirectiveIdRef = useRef<number | null>(null);
  const { markSaved } = useAutosave({
    value: { ...draft, ...schedule },
    enabled: directiveId !== null && initializedDirectiveIdRef.current === directiveId,
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

  const isDraft = directiveId === null;
  if (!isDraft && directiveQuery.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (!isDraft && (directiveQuery.isError || !directiveQuery.data))
    return <p className="font-mono text-sm text-alert">Directive not found.</p>;

  const directive = isDraft ? null : directiveQuery.data ?? null;
  const isThisRunning = !isDraft && runStream.active && runStream.kind === "directive" && runStream.directiveId === directiveId;
  const enabledForStyle = isDraft ? true : (directive?.enabled ?? true);

  // Bypasses the debounce for an instant flip (the button's label/strike-
  // through reads from `directive.enabled`, not `draft.enabled`, so a
  // debounced round-trip would leave it momentarily lying about the current
  // state). Folds the toggle into `draft` and marks the merged value saved
  // so a debounce already pending from an unrelated field edit can't re-
  // send a stale `enabled` value moments later and flip it back.
  function toggleEnabled() {
    if (!directive) return;
    const nextDraft: UpdateDirectiveRequest = { ...draft, enabled: !directive.enabled };
    setDraft(nextDraft);
    markSaved({ ...nextDraft, ...schedule });
    updateMutation.mutate({ ...nextDraft, ...schedule });
  }

  return (
    <article>
      <div className="mb-6 border-b border-dust pb-4">
        <input
          ref={titleInputRef}
          autoFocus={isDraft}
          value={draft.title ?? ""}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          onBlur={() => draftCreate.attempt()}
          placeholder={isDraft ? "e.g. Morning overdue-task check" : "Untitled"}
          className={`w-full font-display text-3xl placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent ${enabledForStyle ? "text-ink" : "text-dust line-through"}`}
        />
      </div>

      {createMutation.isError && (
        <p className="mb-4 font-mono text-sm text-alert">{(createMutation.error as Error).message}</p>
      )}
      {updateMutation.isError && (
        <p className="mb-4 font-mono text-sm text-alert">{(updateMutation.error as Error).message}</p>
      )}

      {paused && (
        <div className="mb-4 border border-alert px-3 py-2 font-mono text-sm text-alert">
          Deputy is paused{settingsQuery.data?.pausedReason ? ` — ${settingsQuery.data.pausedReason}` : "."}{" "}
          <Link to="/settings?from=deputy" className="underline">
            Resume in Settings
          </Link>
        </div>
      )}

      {isThisRunning && (
        <div className="mb-4 border border-accent/40 bg-accent/[0.06] p-3">
          <p className="mb-1 font-mono text-xs uppercase tracking-wide text-accent">Running now</p>
          {runStream.toolCalls.length === 0 ? (
            <p className="font-mono text-xs text-ink">Starting —</p>
          ) : (
            <ul className="space-y-0.5 font-mono text-xs text-ink">
              {runStream.toolCalls.map((call, index) => (
                <li key={index}>
                  {call.done ? (call.error ? "✗" : "✓") : "…"} {call.toolName}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ExhibitLinksLayout
        exhibitId={isDraft ? null : `directive-${directiveId}`}
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("deputy", r, navigate, shellHosted)}
        editable
        draftConnections={draftConnections}
        onDraftConnectionsChange={setDraftConnections}
        actions={
          <ExhibitActionBar>
            {isDraft ? (
              <button
                onClick={() => navigate(resolveChamberPath("/", "deputy", shellHosted))}
                className="tap-target text-slate hover:underline"
              >
                Cancel
              </button>
            ) : (
              <>
                <button
                  onClick={() => runMutation.mutate()}
                  disabled={runMutation.isPending || paused}
                  title={paused ? "Deputy is paused" : undefined}
                  className="tap-target text-accent hover:underline disabled:opacity-50"
                >
                  {runMutation.isPending ? "Running —" : "Run now"}
                </button>
                <button onClick={toggleEnabled} className="tap-target text-accent hover:underline">
                  {directive?.enabled ? "Disable" : "Enable"}
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
          value={draft.body ?? ""}
          onChange={(value) => setDraft((d) => ({ ...d, body: value }))}
          minRows={isDraft ? 10 : 3}
          placeholder={
            isDraft
              ? "Plain English - what should Deputy check or do, and when. Purely time-based ('every morning...') and event-reactive directives both go here."
              : "— No instructions —"
          }
          className="w-full bg-parchment p-3 font-body text-base text-ink focus-within:outline-none"
          renderIcon={(chamber) => getChamberIcon(chamber)}
          onNavigate={(r) => navigateToExhibit("deputy", r, navigate, shellHosted)}
        />
        <ScheduleEditor value={schedule} onChange={setSchedule} eventCatalog={catalogQuery.data ?? []} eventCatalogLoading={catalogQuery.isLoading} />
      </ExhibitLinksLayout>

      {!isDraft && (
        <ConfirmSheet
          open={confirmingDelete}
          title="Delete directive"
          message={`Delete "${directive?.title}"? This cannot be undone.`}
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
