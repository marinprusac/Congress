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
  fetchEventCatalog,
  TriggerEventPicker,
  useAutosave,
  useDraftCreate,
  resolveEditorIdentity,
  useSelfNavigateGuard,
  FormLabel,
} from "@congress/congress-ui";
import type { CapitolExhibitSearchResult } from "@congress/shared-types";
import {
  createAutomation,
  fetchAutomation,
  updateAutomation,
  deleteAutomation,
  fetchAutomationRuns,
  fetchChamberTools,
} from "@/lib/api";
import { ChamberToolPicker } from "@/components/ChamberToolPicker";
import { ArgsEditor } from "@/components/ArgsEditor";
import type { CreateAutomationRequest, UpdateAutomationRequest } from "../../../src/types";

const inputClass = "field-plain font-mono text-sm";
const draftInputClass =
  "w-full border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent";

function parseAutomationId(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

function canCreateAutomation(draft: UpdateAutomationRequest): boolean {
  return Boolean(
    (draft.title ?? "").trim() && (draft.triggerEventType ?? "").trim() && (draft.targetChamber ?? "").trim() && (draft.toolName ?? "").trim()
  );
}

// Handles both "create" (route `/new`, no `:id`) and "edit" (route `/a/:id`)
// as one mounted component - see chamber-notes' NoteEditorPage, which this
// mirrors, for the full reasoning behind merging the two. Unlike a single
// title field, this chamber's create gate needs four fields filled
// (title/trigger/chamber/tool) that can be completed in any order, so the
// trigger/chamber/tool pickers each also attempt the create on change (a
// discrete selection, not a keystroke mid-typing) alongside the title
// field's own blur.
export function AutomationEditorPage() {
  const { id: idParam } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();

  const [automationId, setAutomationId] = useState<number | null>(() => parseAutomationId(idParam));
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draft, setDraft] = useState<UpdateAutomationRequest>({ title: searchParams.get("name") ?? "", body: "" });
  const [draftConnections, setDraftConnections] = useState<CapitolExhibitSearchResult[]>([]);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const { markSelfNavigate, consumeSelfNavigate } = useSelfNavigateGuard();

  const automationQuery = useQuery({
    queryKey: ["automation", automationId],
    queryFn: () => fetchAutomation(automationId as number),
    enabled: automationId !== null,
  });

  const runsQuery = useQuery({
    queryKey: ["automation", automationId, "runs"],
    queryFn: () => fetchAutomationRuns(automationId as number),
    enabled: automationId !== null,
  });

  const catalogQuery = useQuery({ queryKey: ["event-catalog"], queryFn: fetchEventCatalog });

  const toolsQuery = useQuery({
    queryKey: ["chamber-tools", draft.targetChamber],
    queryFn: () => fetchChamberTools(draft.targetChamber!),
    enabled: !!draft.targetChamber,
  });
  const draftTool = toolsQuery.data?.find((t) => t.name === draft.toolName);
  const triggerPayloadFields = catalogQuery.data?.find((e) => e.type === draft.triggerEventType)?.payloadFields;

  const createMutation = useMutation({
    mutationFn: async (d: UpdateAutomationRequest) => {
      const created = await createAutomation({
        title: d.title ?? "",
        body: d.body ?? "",
        enabled: true,
        triggerEventType: d.triggerEventType ?? "",
        targetChamber: d.targetChamber ?? "",
        toolName: d.toolName ?? "",
        argsTemplate: d.argsTemplate ?? {},
      } satisfies CreateAutomationRequest);
      await flushDraftConnections(`automation-${created.id}`, draftConnections);
      return created;
    },
    onSuccess: (created, d) => {
      queryClient.setQueryData(["automation", created.id], created);
      queryClient.invalidateQueries({ queryKey: ["automations"] });
      if (automationId !== null) return;
      initializedAutomationIdRef.current = created.id;
      markSaved(d);
      setAutomationId(created.id);
      markSelfNavigate();
      navigate(resolveChamberPath(`/a/${created.id}`, "automation", shellHosted), { replace: true });
    },
    onError: () => {
      draftCreate.reset();
      showToast("Failed to create automation.", "error");
    },
  });

  // Fires on the title field's blur (see the input's onBlur below) rather
  // than a content-change debounce - see useDraftCreate's own comment.
  const draftCreate = useDraftCreate({
    value: draft,
    canCreate: (v) => automationId === null && canCreateAutomation(v),
    onCreate: (d) => createMutation.mutate(d),
  });

  // The trigger/chamber/tool pickers are discrete selections, not
  // continuous typing - each one settling is as good a "done editing"
  // signal as the title field's own blur, and since creation needs all
  // four filled in whatever order the owner happens to fill them, whichever
  // one lands last is what should fire it. An effect (rather than calling
  // `draftCreate.attempt()` inline right after `setDraft` in each picker's
  // onChange) is required here: `attempt()` reads `draft` through a ref
  // that only catches up on the *next* render, so calling it synchronously
  // in the same handler that just called `setDraft` would still see the
  // pre-update value.
  useEffect(() => {
    draftCreate.attempt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.triggerEventType, draft.targetChamber, draft.toolName]);

  // A navigation between two different ids, or back to the draft/"new"
  // route, reuses this same mounted component - see resolveEditorIdentity's
  // own comment. consumeSelfNavigate() must run first - see
  // useSelfNavigateGuard's own comment for the params-vs-state race it
  // closes (and the duplicate create it caused before this guard existed).
  useEffect(() => {
    if (consumeSelfNavigate()) return;
    const fromUrl = parseAutomationId(idParam);
    if (resolveEditorIdentity(fromUrl, automationId) === "keep") return;
    draftCreate.attempt();
    setAutomationId(fromUrl);
    setDraft({ title: "", body: "" });
    setDraftConnections([]);
    initializedAutomationIdRef.current = null;
    draftCreate.reset();
    if (fromUrl === null) titleInputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idParam, automationId]);

  const updateMutation = useMutation({
    mutationFn: (input: UpdateAutomationRequest) => updateAutomation(automationId as number, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(["automation", automationId], updated);
      queryClient.invalidateQueries({ queryKey: ["automations"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteAutomation(automationId as number),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automations"] });
      navigate(resolveChamberPath("/", "automation", shellHosted));
      showToast("Automation deleted");
    },
    onError: () => showToast("Failed to delete automation.", "error"),
  });

  // Loads the draft exactly once per automation, not on every background
  // refetch - otherwise a resync would stomp in-progress edits. Also covers
  // the just-created automation: its query is pre-seeded via setQueryData
  // above, so this effect's `markSaved` runs immediately without feeding a
  // stale/empty server value back into the editor.
  const initializedAutomationIdRef = useRef<number | null>(null);
  const { markSaved } = useAutosave({
    value: draft,
    enabled: automationId !== null && initializedAutomationIdRef.current === automationId,
    onSave: (d) => updateMutation.mutate(d),
  });
  useEffect(() => {
    if (automationQuery.data && initializedAutomationIdRef.current !== automationQuery.data.id) {
      const a = automationQuery.data;
      const loaded: UpdateAutomationRequest = {
        title: a.title,
        body: a.body,
        triggerEventType: a.triggerEventType,
        conditionField: a.conditionField ?? undefined,
        conditionEquals: a.conditionEquals ?? undefined,
        targetChamber: a.targetChamber,
        toolName: a.toolName,
        argsTemplate: a.argsTemplate,
        enabled: a.enabled,
      };
      setDraft(loaded);
      markSaved(loaded);
      initializedAutomationIdRef.current = a.id;
    }
  }, [automationQuery.data, markSaved]);

  const isDraft = automationId === null;
  if (!isDraft && automationQuery.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (!isDraft && (automationQuery.isError || !automationQuery.data))
    return <p className="font-mono text-sm text-alert">Automation not found.</p>;

  const automation = isDraft ? null : automationQuery.data ?? null;
  const enabledForStyle = isDraft ? true : (automation?.enabled ?? true);

  // Bypasses the debounce for an instant flip (toggles read from
  // `automation.enabled`, not `draft.enabled`, for their label/strikethrough
  // - a debounced round-trip would leave the button momentarily lying about
  // the current state). Folds the toggle into `draft` and marks it saved so
  // a debounce already pending from an unrelated field edit can't re-send a
  // stale `enabled` value moments later and flip it back.
  function toggleEnabled() {
    if (!automation) return;
    const next: UpdateAutomationRequest = { ...draft, enabled: !automation.enabled };
    setDraft(next);
    markSaved(next);
    updateMutation.mutate(next);
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
          placeholder={isDraft ? "Title" : "Untitled"}
          className={`w-full font-display text-3xl placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent ${enabledForStyle ? "text-ink" : "text-dust line-through"}`}
        />
      </div>

      {createMutation.isError && (
        <p className="mb-4 font-mono text-sm text-alert">{(createMutation.error as Error).message}</p>
      )}
      {updateMutation.isError && (
        <p className="mb-4 font-mono text-sm text-alert">{(updateMutation.error as Error).message}</p>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <FormLabel>Trigger event</FormLabel>
          <TriggerEventPicker
            value={draft.triggerEventType ?? ""}
            onChange={(triggerEventType) => setDraft((d) => ({ ...d, triggerEventType }))}
            catalog={catalogQuery.data ?? []}
            loading={catalogQuery.isLoading}
            selectClassName={isDraft ? draftInputClass : inputClass}
          />
        </div>

        {!isDraft && (
          <div>
            <FormLabel>Condition (optional)</FormLabel>
            <div className="flex gap-2">
              <input
                placeholder="payload field"
                value={draft.conditionField ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, conditionField: e.target.value || undefined }))}
                className={inputClass}
              />
              <input
                placeholder="equals"
                value={draft.conditionEquals ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, conditionEquals: e.target.value || undefined }))}
                className={inputClass}
              />
            </div>
          </div>
        )}

        <div className="sm:col-span-2">
          <FormLabel>Action - call a Chamber's tool</FormLabel>
          <ChamberToolPicker
            targetChamber={draft.targetChamber ?? ""}
            toolName={draft.toolName ?? ""}
            onChamberChange={(targetChamber) => setDraft((d) => ({ ...d, targetChamber, argsTemplate: {} }))}
            onToolChange={(toolName) => setDraft((d) => ({ ...d, toolName, argsTemplate: {} }))}
            selectClassName={isDraft ? draftInputClass : inputClass}
          />
        </div>

        <div className="sm:col-span-2">
          <ArgsEditor
            tool={draftTool}
            argsTemplate={draft.argsTemplate ?? {}}
            onChange={(argsTemplate) => setDraft((d) => ({ ...d, argsTemplate }))}
            inputClassName={isDraft ? draftInputClass : inputClass}
            triggerPayloadFields={triggerPayloadFields}
          />
        </div>
      </div>

      <ExhibitLinksLayout
        exhibitId={isDraft ? null : `automation-${automationId}`}
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("automation", r, navigate, shellHosted)}
        editable
        draftConnections={draftConnections}
        onDraftConnectionsChange={setDraftConnections}
        actions={
          <ExhibitActionBar>
            {isDraft ? (
              <button
                onClick={() => navigate(resolveChamberPath("/", "automation", shellHosted))}
                className="tap-target text-slate hover:underline"
              >
                Cancel
              </button>
            ) : (
              <>
                <button onClick={toggleEnabled} className="tap-target text-accent hover:underline">
                  {automation?.enabled ? "Disable" : "Enable"}
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
          minRows={isDraft ? 6 : 3}
          placeholder={isDraft ? "Notes (optional), @ to reference an Exhibit" : "— No notes —"}
          className="w-full bg-parchment p-3 font-body text-base text-ink focus-within:outline-none"
          renderIcon={(chamber) => getChamberIcon(chamber)}
          onNavigate={(r) => navigateToExhibit("automation", r, navigate, shellHosted)}
        />
      </ExhibitLinksLayout>

      {!isDraft && (
        <div className="mt-10">
          <p className="mb-3 font-mono text-xs uppercase tracking-wide text-dust">
            Recent activity {automation?.lastFiredAt ? `— last fired ${new Date(automation.lastFiredAt).toLocaleString()}` : ""}
          </p>
          {runsQuery.data && runsQuery.data.length === 0 && <p className="font-mono text-sm text-dust">— Never fired —</p>}
          {runsQuery.data && runsQuery.data.length > 0 && (
            <ul className="space-y-2">
              {runsQuery.data.map((run) => (
                <li key={run.id} className="border border-dust p-2 font-mono text-xs text-ink">
                  <div className="flex items-center justify-between gap-2 text-dust">
                    <span>{new Date(run.firedAt).toLocaleString()}</span>
                    <span className={run.ok ? "text-accent" : "text-alert"}>{run.ok ? "ok" : "failed"}</span>
                  </div>
                  <div className="mt-1">
                    {run.targetChamber}.{run.toolName}
                  </div>
                  {run.errorMessage && <div className="mt-1 text-alert">{run.errorMessage}</div>}
                  {run.ok && run.result != null && <div className="mt-1 truncate text-dust">{JSON.stringify(run.result)}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!isDraft && (
        <ConfirmSheet
          open={confirmingDelete}
          title="Delete automation"
          message={`Delete "${automation?.title}"? This cannot be undone.`}
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
