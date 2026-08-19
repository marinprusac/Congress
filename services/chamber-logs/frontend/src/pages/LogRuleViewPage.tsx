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
import { PRIORITY_LEVELS, type PriorityLevel } from "@congress/shared-types";
import { fetchLogRule, updateLogRule, deleteLogRule, fetchHistory } from "@/lib/api";
import { fetchEventCatalog } from "@/lib/eventCatalog";
import { TriggerEventPicker } from "@/components/TriggerEventPicker";
import type { UpdateLogRuleRequest } from "../../../src/types";

const inputClass =
  "w-full border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent";

function fieldLabel(children: React.ReactNode) {
  return <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">{children}</label>;
}

export function LogRuleViewPage() {
  const { id } = useParams<{ id: string }>();
  const ruleId = Number(id);
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draft, setDraft] = useState<UpdateLogRuleRequest>({});

  const ruleQuery = useQuery({
    queryKey: ["log-rule", ruleId],
    queryFn: () => fetchLogRule(ruleId),
    enabled: Number.isInteger(ruleId),
  });

  const historyQuery = useQuery({
    queryKey: ["log-rule", ruleId, "history"],
    queryFn: () => fetchHistory({ ruleId }),
    enabled: Number.isInteger(ruleId),
  });

  const catalogQuery = useQuery({ queryKey: ["event-catalog"], queryFn: fetchEventCatalog });

  const updateMutation = useMutation({
    mutationFn: (input: UpdateLogRuleRequest) => updateLogRule(ruleId, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(["log-rule", ruleId], updated);
      queryClient.invalidateQueries({ queryKey: ["log-rules"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteLogRule(ruleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["log-rules"] });
      navigate(resolveChamberPath("/", "logs", shellHosted));
      showToast("Log rule deleted");
    },
    onError: () => showToast("Failed to delete log rule.", "error"),
  });

  useEffect(() => {
    if (ruleQuery.data && !editing) {
      const r = ruleQuery.data;
      setDraft({
        title: r.title,
        body: r.body,
        triggerEventType: r.triggerEventType,
        conditionField: r.conditionField ?? undefined,
        conditionEquals: r.conditionEquals ?? undefined,
        minPriority: r.minPriority ?? undefined,
        recordToHistory: r.recordToHistory,
        notify: r.notify,
        enabled: r.enabled,
      });
    }
  }, [ruleQuery.data, editing]);

  if (!Number.isInteger(ruleId)) return <p className="font-mono text-sm text-alert">Invalid log rule id.</p>;
  if (ruleQuery.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (ruleQuery.isError || !ruleQuery.data) return <p className="font-mono text-sm text-alert">Log rule not found.</p>;

  const rule = ruleQuery.data;

  function save() {
    updateMutation.mutate(draft, { onSuccess: () => setEditing(false) });
  }

  function toggleEnabled() {
    updateMutation.mutate({ enabled: !rule.enabled });
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
            <span className={rule.enabled ? "" : "text-dust line-through"}>{rule.title}</span>
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
            <p className="font-mono text-sm text-ink">{rule.triggerEventType}</p>
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
              {rule.conditionField ? `${rule.conditionField} == ${rule.conditionEquals}` : "— None —"}
            </p>
          )}
        </div>

        <div>
          {fieldLabel("Minimum priority (optional)")}
          {editing ? (
            <select
              value={draft.minPriority ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, minPriority: (e.target.value || undefined) as PriorityLevel | undefined }))}
              className={inputClass}
            >
              <option value="">— No threshold —</option>
              {PRIORITY_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          ) : (
            <p className="font-mono text-sm text-ink">{rule.minPriority ?? "— None —"}</p>
          )}
        </div>

        <div>
          {fieldLabel("Actions")}
          {editing ? (
            <div className="flex flex-col gap-2 pt-1">
              <label className="flex items-center gap-2 font-mono text-sm text-ink">
                <input
                  type="checkbox"
                  checked={draft.recordToHistory ?? false}
                  onChange={(e) => setDraft((d) => ({ ...d, recordToHistory: e.target.checked }))}
                />
                Record to history
              </label>
              <label className="flex items-center gap-2 font-mono text-sm text-ink">
                <input type="checkbox" checked={draft.notify ?? false} onChange={(e) => setDraft((d) => ({ ...d, notify: e.target.checked }))} />
                Push a notification
              </label>
            </div>
          ) : (
            <p className="font-mono text-sm text-ink">
              {[rule.recordToHistory && "Record to history", rule.notify && "Push a notification"].filter(Boolean).join(" · ") || "— None —"}
            </p>
          )}
        </div>

      </div>

      <ExhibitLinksLayout
        exhibitId={`logrule-${ruleId}`}
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("logs", r, navigate, shellHosted)}
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
                  {rule.enabled ? "Disable" : "Enable"}
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
        ) : rule.body ? (
          <ExhibitAnnotatedText
            text={rule.body}
            renderIcon={(chamber) => getChamberIcon(chamber)}
            onNavigate={(r) => navigateToExhibit("logs", r, navigate, shellHosted)}
            className="whitespace-pre-wrap text-base text-ink"
          />
        ) : (
          <p className="whitespace-pre-wrap text-base text-dust">— No notes —</p>
        )}
      </ExhibitLinksLayout>

      <div className="mt-10 border-t border-dust pt-6">
        <p className="mb-3 font-mono text-xs uppercase tracking-wide text-dust">
          Recent history {rule.lastFiredAt ? `— last fired ${new Date(rule.lastFiredAt).toLocaleString()}` : ""}
        </p>
        {historyQuery.data && historyQuery.data.length === 0 && <p className="font-mono text-sm text-dust">— Never fired —</p>}
        {historyQuery.data && historyQuery.data.length > 0 && (
          <ul className="space-y-2">
            {historyQuery.data.map((entry) => (
              <li key={entry.id} className="border border-dust p-2 font-mono text-xs text-ink">
                <div className="flex items-center justify-between gap-2 text-dust">
                  <span>{new Date(entry.occurredAt).toLocaleString()}</span>
                  <span>{entry.priority}</span>
                </div>
                <div className="mt-1 truncate text-dust">{JSON.stringify(entry.payload)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmSheet
        open={confirmingDelete}
        title="Delete log rule"
        message={`Delete "${rule.title}"? This cannot be undone.`}
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
