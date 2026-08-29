import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getChamberIcon, showToast, PayloadFieldPicker } from "@congress/congress-ui";
import { fetchEventSettings, updateEventSettings, fetchHistory } from "@/lib/api";
import { PayloadView, summarizePayload } from "@/components/PayloadView";
import type { EventHistoryEntry, UpdateEventSettingsRequest } from "../../../src/types";

const inputClass =
  "w-full border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function fieldLabel(children: React.ReactNode) {
  return <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">{children}</label>;
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
  const titleRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const urlRef = useRef<HTMLInputElement | null>(null);
  const dedupeRef = useRef<HTMLInputElement | null>(null);

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
        historyRetentionMs: r.historyRetentionMs,
        notify: r.notify,
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
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  {fieldLabel(`Title (optional — defaults to "${row.label}")`)}
                  <PayloadFieldPicker
                    fields={row.payloadFields}
                    targetRef={titleRef}
                    value={draft.notifyTitleTemplate ?? ""}
                    onChange={(next) => set("notifyTitleTemplate", next || null)}
                    label="Insert field into title"
                  />
                </div>
                <input
                  ref={titleRef}
                  value={draft.notifyTitleTemplate ?? ""}
                  onChange={(e) => set("notifyTitleTemplate", e.target.value || null)}
                  placeholder="{{payload.x}} interpolated"
                  className={inputClass}
                />
              </div>
              <div>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  {fieldLabel("Body (optional)")}
                  <PayloadFieldPicker
                    fields={row.payloadFields}
                    targetRef={bodyRef}
                    value={draft.notifyBodyTemplate ?? ""}
                    onChange={(next) => set("notifyBodyTemplate", next || null)}
                    label="Insert field into body"
                  />
                </div>
                <textarea
                  ref={bodyRef}
                  value={draft.notifyBodyTemplate ?? ""}
                  onChange={(e) => set("notifyBodyTemplate", e.target.value || null)}
                  placeholder="{{payload.x}} interpolated"
                  rows={2}
                  className={inputClass}
                />
              </div>
              <div>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  {fieldLabel("Link (optional)")}
                  <PayloadFieldPicker
                    fields={row.payloadFields}
                    targetRef={urlRef}
                    value={draft.notifyUrlTemplate ?? ""}
                    onChange={(next) => set("notifyUrlTemplate", next || null)}
                    label="Insert field into link"
                  />
                </div>
                <input
                  ref={urlRef}
                  value={draft.notifyUrlTemplate ?? ""}
                  onChange={(e) => set("notifyUrlTemplate", e.target.value || null)}
                  placeholder="{{payload.x}} interpolated"
                  className={inputClass}
                />
              </div>
              <div>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  {fieldLabel("Dedupe key (optional — defaults to one notification per event type)")}
                  <PayloadFieldPicker
                    fields={row.payloadFields}
                    targetRef={dedupeRef}
                    value={draft.notifyDedupeKeyTemplate ?? ""}
                    onChange={(next) => set("notifyDedupeKeyTemplate", next || null)}
                    label="Insert field into dedupe key"
                  />
                </div>
                <input
                  ref={dedupeRef}
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
              <HistoryEntryRow key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

// <details>/<summary> rather than hand-rolled expand state: free keyboard
// and tap support, and each row's open/closed state doesn't need tracking
// in a parent map. Collapsed shows a human-readable one-line preview (see
// summarizePayload); expanded renders the full payload via PayloadView -
// never a raw JSON.stringify dump, per this Chamber's whole point of
// existing (surfacing events to the owner, not to a debugger).
function HistoryEntryRow({ entry }: { entry: EventHistoryEntry }) {
  return (
    <li className="border border-dust font-mono text-xs text-ink">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3 marker:content-none [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 text-dust transition-transform group-open:rotate-90">▸</span>
            <span className="min-w-0 truncate text-dust">{summarizePayload(entry.payload)}</span>
          </span>
          <span className="flex shrink-0 items-baseline gap-2 text-dust">
            <span>{new Date(entry.occurredAt).toLocaleString()}</span>
          </span>
        </summary>
        <div className="border-t border-dust p-3 text-sm">
          <PayloadView value={entry.payload} />
        </div>
      </details>
    </li>
  );
}
