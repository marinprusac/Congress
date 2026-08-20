import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getChamberIcon, showToast } from "@congress/congress-ui";
import { PRIORITY_LEVELS, type PriorityLevel } from "@congress/shared-types";
import { fetchEventSettings, updateEventSettings, fetchHistory } from "@/lib/api";
import type { UpdateEventSettingsRequest } from "../../../src/types";

const inputClass =
  "w-full border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function fieldLabel(children: React.ReactNode) {
  return <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">{children}</label>;
}

function PriorityThresholdSelect({ value, onChange }: { value: PriorityLevel | ""; onChange: (v: PriorityLevel | "") => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as PriorityLevel | "")} className={inputClass}>
      <option value="">— No threshold (fires at any priority) —</option>
      {PRIORITY_LEVELS.map((level) => (
        <option key={level} value={level}>
          {level}
        </option>
      ))}
    </select>
  );
}

// A settings row per known event type - no delete, no title/body/condition,
// nothing to create. `label`/`description` are a read-only cache of that
// event's own manifest catalog entry (eventCatalogSync.ts); everything
// below is the owner's own configuration.
export function EventSettingsDetailPage() {
  const { eventType: rawEventType } = useParams<{ eventType: string }>();
  const eventType = rawEventType ? decodeURIComponent(rawEventType) : "";
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<UpdateEventSettingsRequest>({});
  const [dirty, setDirty] = useState(false);

  const rowQuery = useQuery({
    queryKey: ["event-settings", eventType],
    queryFn: () => fetchEventSettings(eventType),
    enabled: !!eventType,
  });

  const historyQuery = useQuery({
    queryKey: ["event-settings", eventType, "history"],
    queryFn: () => fetchHistory({ eventType }),
    enabled: !!eventType,
  });

  const updateMutation = useMutation({
    mutationFn: (input: UpdateEventSettingsRequest) => updateEventSettings(eventType, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(["event-settings", eventType], updated);
      queryClient.invalidateQueries({ queryKey: ["event-settings"] });
      setDirty(false);
      showToast("Saved");
    },
    onError: () => showToast("Failed to save.", "error"),
  });

  useEffect(() => {
    if (rowQuery.data && !dirty) {
      const r = rowQuery.data;
      setDraft({
        recordToHistory: r.recordToHistory,
        historyMinPriority: r.historyMinPriority,
        historyRetentionMs: r.historyRetentionMs,
        notify: r.notify,
        notifyMinPriority: r.notifyMinPriority,
        notifyTitleTemplate: r.notifyTitleTemplate,
        notifyBodyTemplate: r.notifyBodyTemplate,
        notifyUrlTemplate: r.notifyUrlTemplate,
        notifyDedupeKeyTemplate: r.notifyDedupeKeyTemplate,
      });
    }
  }, [rowQuery.data, dirty]);

  if (!eventType) return <p className="font-mono text-sm text-alert">Invalid event type.</p>;
  if (rowQuery.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (rowQuery.isError || !rowQuery.data) return <p className="font-mono text-sm text-alert">Event type not found.</p>;

  const row = rowQuery.data;

  function set<K extends keyof UpdateEventSettingsRequest>(key: K, value: UpdateEventSettingsRequest[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  }

  function save() {
    updateMutation.mutate(draft);
  }

  return (
    <article>
      <div className="mb-6 flex items-start gap-3 border-b border-dust pb-4">
        {getChamberIcon(row.chamber, { className: "mt-1 h-6 w-6 shrink-0 text-dust" })}
        <div>
          <h2 className="font-display text-3xl text-ink">{row.label}</h2>
          {row.description && <p className="mt-1 font-mono text-sm text-dust">{row.description}</p>}
          <p className="mt-1 font-mono text-xs text-dust">
            {row.eventType}
            {row.lastFiredAt ? ` · last fired ${new Date(row.lastFiredAt).toLocaleString()}` : ""}
          </p>
        </div>
      </div>

      {updateMutation.isError && <p className="mb-4 font-mono text-sm text-alert">{(updateMutation.error as Error).message}</p>}

      <div className="mb-6 space-y-6">
        <div>
          <label className="flex items-center gap-2 font-mono text-sm text-ink">
            <input type="checkbox" checked={draft.recordToHistory ?? false} onChange={(e) => set("recordToHistory", e.target.checked)} />
            Record to history
          </label>
          {draft.recordToHistory && (
            <div className="mt-3 grid grid-cols-1 gap-4 pl-6 sm:grid-cols-2">
              <div>
                {fieldLabel("Minimum priority")}
                <PriorityThresholdSelect
                  value={draft.historyMinPriority ?? ""}
                  onChange={(v) => set("historyMinPriority", v || null)}
                />
              </div>
              <div>
                {fieldLabel("Retention (days, optional)")}
                <input
                  type="number"
                  min={1}
                  placeholder="90 (default)"
                  value={draft.historyRetentionMs ? Math.round(draft.historyRetentionMs / MS_PER_DAY) : ""}
                  onChange={(e) => set("historyRetentionMs", e.target.value ? Number(e.target.value) * MS_PER_DAY : null)}
                  className={inputClass}
                />
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="flex items-center gap-2 font-mono text-sm text-ink">
            <input type="checkbox" checked={draft.notify ?? false} onChange={(e) => set("notify", e.target.checked)} />
            Push a notification
          </label>
          {draft.notify && (
            <div className="mt-3 flex flex-col gap-4 pl-6">
              <div>
                {fieldLabel("Minimum priority")}
                <PriorityThresholdSelect value={draft.notifyMinPriority ?? ""} onChange={(v) => set("notifyMinPriority", v || null)} />
              </div>
              <div>
                {fieldLabel(`Title (optional — defaults to "${row.label}")`)}
                <input
                  value={draft.notifyTitleTemplate ?? ""}
                  onChange={(e) => set("notifyTitleTemplate", e.target.value || null)}
                  placeholder="{{payload.x}} interpolated"
                  className={inputClass}
                />
              </div>
              <div>
                {fieldLabel("Body (optional)")}
                <textarea
                  value={draft.notifyBodyTemplate ?? ""}
                  onChange={(e) => set("notifyBodyTemplate", e.target.value || null)}
                  placeholder="{{payload.x}} interpolated"
                  rows={2}
                  className={inputClass}
                />
              </div>
              <div>
                {fieldLabel("Link (optional)")}
                <input
                  value={draft.notifyUrlTemplate ?? ""}
                  onChange={(e) => set("notifyUrlTemplate", e.target.value || null)}
                  placeholder="{{payload.x}} interpolated"
                  className={inputClass}
                />
              </div>
              <div>
                {fieldLabel("Dedupe key (optional — defaults to one notification per event type)")}
                <input
                  value={draft.notifyDedupeKeyTemplate ?? ""}
                  onChange={(e) => set("notifyDedupeKeyTemplate", e.target.value || null)}
                  placeholder="e.g. {{payload.taskId}} for one per entity"
                  className={inputClass}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={save}
        disabled={!dirty || updateMutation.isPending}
        className="tap-target border border-accent px-4 py-2 font-mono text-xs uppercase tracking-wide text-accent hover:bg-accent hover:text-parchment disabled:opacity-50"
      >
        {updateMutation.isPending ? "Saving —" : "Save"}
      </button>

      <div className="mt-10 border-t border-dust pt-6">
        <p className="mb-3 font-mono text-xs uppercase tracking-wide text-dust">Recent history</p>
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
    </article>
  );
}
