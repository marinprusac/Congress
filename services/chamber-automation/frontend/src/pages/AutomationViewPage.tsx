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
} from "@congress/congress-ui";
import { fetchAutomation, updateAutomation, deleteAutomation, fetchAutomationRuns, fetchChamberTools } from "@/lib/api";
import { fetchEventCatalog } from "@/lib/eventCatalog";
import { TriggerEventPicker } from "@/components/TriggerEventPicker";
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
  const [editing, setEditing] = useState(false);
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

  useEffect(() => {
    if (automationQuery.data && !editing) {
      const a = automationQuery.data;
      setDraft({
        title: a.title,
        body: a.body,
        triggerEventType: a.triggerEventType,
        conditionField: a.conditionField ?? undefined,
        conditionEquals: a.conditionEquals ?? undefined,
        targetChamber: a.targetChamber,
        toolName: a.toolName,
        argsTemplate: a.argsTemplate,
        enabled: a.enabled,
      });
    }
  }, [automationQuery.data, editing]);

  if (!Number.isInteger(automationId)) return <p className="font-mono text-sm text-alert">Invalid automation id.</p>;
  if (automationQuery.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (automationQuery.isError || !automationQuery.data) return <p className="font-mono text-sm text-alert">Automation not found.</p>;

  const automation = automationQuery.data;

  function save() {
    updateMutation.mutate(draft, { onSuccess: () => setEditing(false) });
  }

  function toggleEnabled() {
    updateMutation.mutate({ enabled: !automation.enabled });
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
          <h2 className="flex min-w-0 items-center gap-3 font-display text-3xl text-ink">
            <span className={automation.enabled ? "" : "text-dust line-through"}>{automation.title}</span>
          </h2>
        )}
      </div>

      {updateMutation.isError && <p className="mb-4 font-mono text-sm text-alert">{(updateMutation.error as Error).message}</p>}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          {fieldLabel("Trigger event")}
          {editing ? (
            <TriggerEventPicker
              value={draft.triggerEventType ?? ""}
              onChange={(triggerEventType) => setDraft((d) => ({ ...d, triggerEventType }))}
              catalog={catalogQuery.data ?? []}
              loading={catalogQuery.isLoading}
              selectClassName={inputClass}
            />
          ) : (
            <p className="font-mono text-sm text-ink">{automation.triggerEventType}</p>
          )}
        </div>

        <div>
          {fieldLabel("Condition (optional)")}
          {editing ? (
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
          ) : (
            <p className="font-mono text-sm text-ink">
              {automation.conditionField ? `${automation.conditionField} == ${automation.conditionEquals}` : "— None —"}
            </p>
          )}
        </div>

        <div className="sm:col-span-2">
          {fieldLabel("Action - call a Chamber's tool")}
          {editing ? (
            <ChamberToolPicker
              targetChamber={draft.targetChamber ?? ""}
              toolName={draft.toolName ?? ""}
              onChamberChange={(targetChamber) => setDraft((d) => ({ ...d, targetChamber, argsTemplate: {} }))}
              onToolChange={(toolName) => setDraft((d) => ({ ...d, toolName, argsTemplate: {} }))}
              selectClassName={inputClass}
            />
          ) : (
            <p className="font-mono text-sm text-ink">
              {automation.targetChamber}.{automation.toolName}
            </p>
          )}
        </div>

        {editing && (
          <div className="sm:col-span-2">
            <ArgsEditor
              tool={draftTool}
              argsTemplate={draft.argsTemplate ?? {}}
              onChange={(argsTemplate) => setDraft((d) => ({ ...d, argsTemplate }))}
              inputClassName={inputClass}
              triggerPayloadFields={triggerPayloadFields}
            />
          </div>
        )}

        {!editing && Object.keys(automation.argsTemplate).length > 0 && (
          <div className="sm:col-span-2">
            {fieldLabel("Arguments")}
            <ul className="font-mono text-sm text-ink">
              {Object.entries(automation.argsTemplate).map(([key, value]) => (
                <li key={key}>
                  {key} = {value}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <ExhibitLinksLayout
        exhibitId={`automation-${automationId}`}
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("automation", r, navigate, shellHosted)}
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
                <button onClick={toggleEnabled} className="tap-target text-accent hover:underline">
                  {automation.enabled ? "Disable" : "Enable"}
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
          <ExhibitTextarea
            value={draft.body ?? ""}
            onChange={(value) => setDraft((d) => ({ ...d, body: value }))}
            rows={8}
            className="w-full border border-dust bg-parchment p-3 font-mono text-base text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
            renderIcon={(chamber) => getChamberIcon(chamber)}
          />
        ) : automation.body ? (
          <ExhibitAnnotatedText
            text={automation.body}
            renderIcon={(chamber) => getChamberIcon(chamber)}
            onNavigate={(r) => navigateToExhibit("automation", r, navigate, shellHosted)}
            className="whitespace-pre-wrap text-base text-ink"
          />
        ) : (
          <p className="whitespace-pre-wrap text-base text-dust">— No notes —</p>
        )}
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
