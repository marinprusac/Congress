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
  TriggerEventPicker,
  useAutosave,
} from "@congress/congress-ui";
import { fetchAutomation, updateAutomation, deleteAutomation, fetchAutomationRuns, fetchChamberTools } from "@/lib/api";
import { ChamberToolPicker } from "@/components/ChamberToolPicker";
import { ArgsEditor } from "@/components/ArgsEditor";
import type { UpdateAutomationRequest } from "../../../src/types";

const inputClass =
  "w-full border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent";

function fieldLabel(children: React.ReactNode) {
  return <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">{children}</label>;
}

export function AutomationViewPage() {
  const { id } = useParams<{ id: string }>();
  const automationId = Number(id);
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draft, setDraft] = useState<UpdateAutomationRequest>({});

  const automationQuery = useQuery({
    queryKey: ["automation", automationId],
    queryFn: () => fetchAutomation(automationId),
    enabled: Number.isInteger(automationId),
  });

  const runsQuery = useQuery({
    queryKey: ["automation", automationId, "runs"],
    queryFn: () => fetchAutomationRuns(automationId),
    enabled: Number.isInteger(automationId),
  });

  const catalogQuery = useQuery({ queryKey: ["event-catalog"], queryFn: fetchEventCatalog });

  const toolsQuery = useQuery({
    queryKey: ["chamber-tools", draft.targetChamber],
    queryFn: () => fetchChamberTools(draft.targetChamber!),
    enabled: !!draft.targetChamber,
  });
  const draftTool = toolsQuery.data?.find((t) => t.name === draft.toolName);
  const triggerPayloadFields = catalogQuery.data?.find((e) => e.type === draft.triggerEventType)?.payloadFields;

  const updateMutation = useMutation({
    mutationFn: (input: UpdateAutomationRequest) => updateAutomation(automationId, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(["automation", automationId], updated);
      queryClient.invalidateQueries({ queryKey: ["automations"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteAutomation(automationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automations"] });
      navigate(resolveChamberPath("/", "automation", shellHosted));
      showToast("Automation deleted");
    },
    onError: () => showToast("Failed to delete automation.", "error"),
  });

  // Loads the draft exactly once per automation, not on every background
  // refetch - otherwise a resync would stomp in-progress edits.
  const initializedAutomationIdRef = useRef<number | null>(null);
  const { markSaved } = useAutosave({
    value: draft,
    enabled: initializedAutomationIdRef.current !== null,
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

  if (!Number.isInteger(automationId)) return <p className="font-mono text-sm text-alert">Invalid automation id.</p>;
  if (automationQuery.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (automationQuery.isError || !automationQuery.data) return <p className="font-mono text-sm text-alert">Automation not found.</p>;

  const automation = automationQuery.data;

  // Bypasses the debounce for an instant flip (toggles read from
  // `automation.enabled`, not `draft.enabled`, for their label/strikethrough
  // - a debounced round-trip would leave the button momentarily lying about
  // the current state). Folds the toggle into `draft` and marks it saved so
  // a debounce already pending from an unrelated field edit can't re-send a
  // stale `enabled` value moments later and flip it back.
  function toggleEnabled() {
    const next: UpdateAutomationRequest = { ...draft, enabled: !automation.enabled };
    setDraft(next);
    markSaved(next);
    updateMutation.mutate(next);
  }

  return (
    <article>
      <div className="mb-6 border-b border-dust pb-4">
        <input
          value={draft.title ?? ""}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          placeholder="Untitled"
          className={`w-full font-display text-3xl placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent ${automation.enabled ? "text-ink" : "text-dust line-through"}`}
        />
      </div>

      {updateMutation.isError && <p className="mb-4 font-mono text-sm text-alert">{(updateMutation.error as Error).message}</p>}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          {fieldLabel("Trigger event")}
          <TriggerEventPicker
            value={draft.triggerEventType ?? ""}
            onChange={(triggerEventType) => setDraft((d) => ({ ...d, triggerEventType }))}
            catalog={catalogQuery.data ?? []}
            loading={catalogQuery.isLoading}
            selectClassName={inputClass}
          />
        </div>

        <div>
          {fieldLabel("Condition (optional)")}
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

        <div className="sm:col-span-2">
          {fieldLabel("Action - call a Chamber's tool")}
          <ChamberToolPicker
            targetChamber={draft.targetChamber ?? ""}
            toolName={draft.toolName ?? ""}
            onChamberChange={(targetChamber) => setDraft((d) => ({ ...d, targetChamber, argsTemplate: {} }))}
            onToolChange={(toolName) => setDraft((d) => ({ ...d, toolName, argsTemplate: {} }))}
            selectClassName={inputClass}
          />
        </div>

        <div className="sm:col-span-2">
          <ArgsEditor
            tool={draftTool}
            argsTemplate={draft.argsTemplate ?? {}}
            onChange={(argsTemplate) => setDraft((d) => ({ ...d, argsTemplate }))}
            inputClassName={inputClass}
            triggerPayloadFields={triggerPayloadFields}
          />
        </div>
      </div>

      <ExhibitLinksLayout
        exhibitId={`automation-${automationId}`}
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("automation", r, navigate, shellHosted)}
        editable
        actions={
          <ExhibitActionBar>
            <button onClick={toggleEnabled} className="tap-target text-accent hover:underline">
              {automation.enabled ? "Disable" : "Enable"}
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
          minRows={8}
          placeholder="— No notes —"
          className="w-full bg-parchment p-3 font-body text-base text-ink focus-within:outline-none"
          renderIcon={(chamber) => getChamberIcon(chamber)}
          onNavigate={(r) => navigateToExhibit("automation", r, navigate, shellHosted)}
        />
      </ExhibitLinksLayout>

      <div className="mt-10 border-t border-dust pt-6">
        <p className="mb-3 font-mono text-xs uppercase tracking-wide text-dust">
          Recent activity {automation.lastFiredAt ? `— last fired ${new Date(automation.lastFiredAt).toLocaleString()}` : ""}
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

      <ConfirmSheet
        open={confirmingDelete}
        title="Delete automation"
        message={`Delete "${automation.title}"? This cannot be undone.`}
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
