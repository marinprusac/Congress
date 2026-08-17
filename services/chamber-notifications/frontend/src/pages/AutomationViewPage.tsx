import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ExhibitTextarea,
  ExhibitActionBar,
  ExhibitAnnotatedText,
  ExhibitSharingBadge,
  ExhibitLinksLayout,
  ShareControl,
  navigateToExhibit,
  getChamberIcon,
  useShellHosted,
  resolveChamberPath,
  ConfirmSheet,
  showToast,
} from "@congress/congress-ui";
import { fetchAutomation, updateAutomation, deleteAutomation, fetchAutomationRuns } from "@/lib/api";
import { fetchEventCatalog } from "@/lib/eventCatalog";
import { TriggerEventPicker } from "@/components/TriggerEventPicker";
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
      navigate(resolveChamberPath("/", "notifications", shellHosted));
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
        actionTitleTemplate: a.actionTitleTemplate ?? undefined,
        actionBodyTemplate: a.actionBodyTemplate ?? undefined,
        actionUrlTemplate: a.actionUrlTemplate ?? undefined,
        actionDedupeKeyTemplate: a.actionDedupeKeyTemplate,
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
            <ExhibitSharingBadge exhibitId={`automation-${automationId}`} className="exhibit-sharing-badge" />
          </h2>
        )}
      </div>

      {updateMutation.isError && (
        <p className="mb-4 font-mono text-sm text-alert">{(updateMutation.error as Error).message}</p>
      )}

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

        <div>
          {fieldLabel("Dedupe key")}
          {editing ? (
            <input
              value={draft.actionDedupeKeyTemplate ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, actionDedupeKeyTemplate: e.target.value }))}
              className={inputClass}
            />
          ) : (
            <p className="font-mono text-sm text-ink">{automation.actionDedupeKeyTemplate}</p>
          )}
        </div>

        <div>
          {fieldLabel("Notification title")}
          {editing ? (
            <input
              value={draft.actionTitleTemplate ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, actionTitleTemplate: e.target.value }))}
              className={inputClass}
            />
          ) : (
            <p className="font-mono text-sm text-ink">{automation.actionTitleTemplate || "— None —"}</p>
          )}
        </div>

        <div>
          {fieldLabel("Notification body")}
          {editing ? (
            <input
              value={draft.actionBodyTemplate ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, actionBodyTemplate: e.target.value }))}
              className={inputClass}
            />
          ) : (
            <p className="font-mono text-sm text-ink">{automation.actionBodyTemplate || "— None —"}</p>
          )}
        </div>

        <div className="sm:col-span-2">
          {fieldLabel("Link")}
          {editing ? (
            <input
              value={draft.actionUrlTemplate ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, actionUrlTemplate: e.target.value }))}
              className={inputClass}
            />
          ) : (
            <p className="font-mono text-sm text-ink">{automation.actionUrlTemplate || "— None —"}</p>
          )}
        </div>
      </div>

      <ExhibitLinksLayout
        exhibitId={`automation-${automationId}`}
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("notifications", r, navigate, shellHosted)}
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
                <ShareControl chamber="notifications" exhibitId={`automation-${automationId}`} exhibitName={automation.title} />
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
            onNavigate={(r) => navigateToExhibit("notifications", r, navigate, shellHosted)}
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
                <div className="text-dust">{new Date(run.firedAt).toLocaleString()}</div>
                {run.resultTitle && <div className="mt-1">{run.resultTitle}</div>}
                {run.resultBody && <div className="text-slate">{run.resultBody}</div>}
                <div className="mt-1 truncate text-dust">{JSON.stringify(run.payload)}</div>
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
