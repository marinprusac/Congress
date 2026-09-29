import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UpdateAiSettingsRequest } from "@congress/shared-types";
import { FormLabel, StackLink, useAutosave, fetchAiSettings, aiSettingsQueryKey } from "@congress/congress-ui";
import { aiSpendQueryKey, fetchAiSpend, updateAiSettings } from "@/lib/aiApi";
import { AiActivity } from "./AiActivity";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const inputClass =
  "w-full border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent";

// Settings -> AI: the one pause switch and daily budget shared by the chat
// and every other run, the proactive AI's own controls, and the run log.
export function AiSettingsTab() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: aiSettingsQueryKey, queryFn: fetchAiSettings });
  const spendQuery = useQuery({ queryKey: aiSpendQueryKey, queryFn: fetchAiSpend, refetchInterval: 60_000 });

  const [draft, setDraft] = useState<UpdateAiSettingsRequest>({});

  const mutation = useMutation({
    mutationFn: (input: UpdateAiSettingsRequest) => updateAiSettings(input),
    onSuccess: (updated) => queryClient.setQueryData(aiSettingsQueryKey, updated),
  });

  // Loads the draft exactly once - a background refetch (e.g. the spend
  // poll) must never stomp an in-progress edit.
  const initializedRef = useRef(false);
  const { markSaved } = useAutosave({
    value: draft,
    enabled: initializedRef.current,
    onSave: (d) => mutation.mutate(d),
  });
  useEffect(() => {
    if (settingsQuery.data && !initializedRef.current) {
      const s = settingsQuery.data;
      const loaded: UpdateAiSettingsRequest = {
        contextPrompt: s.contextPrompt,
        budgetCapUsd: s.budgetCapUsd,
        model: s.model,
        retentionDays: s.retentionDays,
        maxPushesPerDay: s.maxPushesPerDay,
        quietHoursStart: s.quietHoursStart,
        quietHoursEnd: s.quietHoursEnd,
        timeZone: s.timeZone,
        proactiveEnabled: s.proactiveEnabled,
        proactiveBudgetUsd: s.proactiveBudgetUsd,
        gateModel: s.gateModel,
        gateSensitivity: s.gateSensitivity,
        heartbeatHours: s.heartbeatHours,
      };
      setDraft(loaded);
      markSaved(loaded);
      initializedRef.current = true;
    }
  }, [settingsQuery.data, markSaved]);

  const pauseMutation = useMutation({
    mutationFn: (paused: boolean) => updateAiSettings({ paused, pausedReason: paused ? "Paused by owner." : null }),
    onSuccess: (updated) => queryClient.setQueryData(aiSettingsQueryKey, updated),
  });

  if (settingsQuery.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (settingsQuery.isError || !settingsQuery.data) return <p className="font-mono text-sm text-alert">Failed to reach the AI settings API.</p>;

  const settings = settingsQuery.data;

  return (
    <section>
      <div className="mb-6 border border-dust p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-display text-lg text-ink">{settings.paused ? "Paused" : "Active"}</p>
            {settings.paused && settings.pausedReason && <p className="mt-1 font-mono text-xs text-alert">{settings.pausedReason}</p>}
            {spendQuery.data && (
              <p className="mt-1 font-mono text-xs text-dust">
                Spent today: ${spendQuery.data.spentTodayUsd.toFixed(2)} of ${settings.budgetCapUsd.toFixed(2)}
                {" · "}proactive ${spendQuery.data.proactiveSpentTodayUsd.toFixed(2)} of ${settings.proactiveBudgetUsd.toFixed(2)}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => pauseMutation.mutate(!settings.paused)}
            disabled={pauseMutation.isPending}
            className={`border px-4 py-2 font-mono text-xs uppercase tracking-wide disabled:opacity-50 ${
              settings.paused ? "border-accent text-accent hover:bg-accent hover:text-parchment" : "border-alert text-alert hover:bg-alert hover:text-parchment"
            }`}
          >
            {settings.paused ? "Resume" : "Pause"}
          </button>
        </div>
      </div>

      <div>
        <FormLabel>Context</FormLabel>
        <textarea
          value={draft.contextPrompt ?? ""}
          onChange={(e) => setDraft((d) => ({ ...d, contextPrompt: e.target.value }))}
          rows={3}
          placeholder="Handed to every run, chat or proactive. e.g. Be terse. Always double-check before anything irreversible."
          className={`${inputClass} mb-4`}
        />

        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <FormLabel>Daily budget cap (USD)</FormLabel>
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={draft.budgetCapUsd ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, budgetCapUsd: Number(e.target.value) }))}
              className={inputClass}
            />
          </div>
          <div>
            <FormLabel>Model</FormLabel>
            <input value={draft.model ?? ""} onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))} className={inputClass} />
          </div>
          <div>
            <FormLabel>Chat/spend retention (days)</FormLabel>
            <input
              type="number"
              min={1}
              value={draft.retentionDays ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, retentionDays: Number(e.target.value) }))}
              className={inputClass}
            />
          </div>
        </div>

        <StackLink to="/chat/memory" className="mb-6 flex items-center justify-between border border-dust p-4 text-ink hover:border-accent">
          <span>
            <span className="block font-display text-lg">Memory</span>
            <span className="block font-mono text-xs text-dust">What Congress is tracking and knows about you</span>
          </span>
          <span aria-hidden="true">→</span>
        </StackLink>

        <h3 className="mb-3 font-mono text-xs uppercase tracking-widest text-dust">Reaching you</h3>
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <FormLabel>Phone notifications per day</FormLabel>
            <input
              type="number"
              min={0}
              max={50}
              value={draft.maxPushesPerDay ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, maxPushesPerDay: Math.max(0, Math.round(Number(e.target.value))) }))}
              className={inputClass}
            />
            <p className="mt-1 font-mono text-[0.65rem] text-dust">Beyond this, asks still arrive - just silently.</p>
          </div>
          <div>
            <FormLabel>Quiet hours</FormLabel>
            <div className="flex items-center gap-2">
              <select
                value={draft.quietHoursStart ?? ""}
                aria-label="Quiet from"
                onChange={(e) => setDraft((d) => ({ ...d, quietHoursStart: e.target.value === "" ? null : Number(e.target.value), quietHoursEnd: e.target.value === "" ? null : (d.quietHoursEnd ?? 7) }))}
                className={inputClass}
              >
                <option value="">Off</option>
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
              {draft.quietHoursStart != null ? (
                <>
                  <span className="font-mono text-xs text-dust">to</span>
                  <select
                    value={draft.quietHoursEnd ?? 7}
                    aria-label="Quiet until"
                    onChange={(e) => setDraft((d) => ({ ...d, quietHoursEnd: Number(e.target.value) }))}
                    className={inputClass}
                  >
                    {HOURS.map((h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, "0")}:00
                      </option>
                    ))}
                  </select>
                </>
              ) : null}
            </div>
          </div>
          <div className="sm:col-span-2">
            <FormLabel>Time zone</FormLabel>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                value={draft.timeZone ?? ""}
                placeholder="Server default"
                onChange={(e) => setDraft((d) => ({ ...d, timeZone: e.target.value.trim() || null }))}
                className={inputClass}
              />
              {draft.timeZone !== deviceZone() ? (
                <button type="button" className="self-start shrink-0 border border-dust px-3 py-2 font-mono text-xs uppercase text-ink" onClick={() => setDraft((d) => ({ ...d, timeZone: deviceZone() }))}>
                  Use {deviceZone()}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <h3 className="mb-3 font-mono text-xs uppercase tracking-widest text-dust">Proactive</h3>
        <label className="mb-4 flex items-start gap-3">
          <input type="checkbox" className="mt-1" checked={draft.proactiveEnabled ?? true} onChange={(e) => setDraft((d) => ({ ...d, proactiveEnabled: e.target.checked }))} />
          <span>
            <span className="block text-ink">Let Congress act on its own</span>
            <span className="block font-mono text-xs text-dust">Checks on what it's tracking, and a look when enough happens. Off stops both; chat still works.</span>
          </span>
        </label>
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <FormLabel>How often it looks</FormLabel>
            <select value={draft.gateSensitivity ?? "normal"} onChange={(e) => setDraft((d) => ({ ...d, gateSensitivity: e.target.value as "low" | "normal" | "high" }))} className={inputClass}>
              <option value="low">Rarely - only when a lot happens</option>
              <option value="normal">Normally</option>
              <option value="high">Often - even small changes</option>
            </select>
          </div>
          <div>
            <FormLabel>Look anyway every (hours)</FormLabel>
            <input
              type="number"
              min={0.5}
              max={48}
              step={0.5}
              value={draft.heartbeatHours ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, heartbeatHours: Number(e.target.value) }))}
              className={inputClass}
            />
          </div>
          <div>
            <FormLabel>Proactive budget (USD / day)</FormLabel>
            <input
              type="number"
              min={0}
              step={0.1}
              value={draft.proactiveBudgetUsd ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, proactiveBudgetUsd: Number(e.target.value) }))}
              className={inputClass}
            />
            <p className="mt-1 font-mono text-[0.65rem] text-dust">Part of the daily cap above, for runs you didn't start.</p>
          </div>
          <div>
            <FormLabel>Model for deciding whether to look</FormLabel>
            <input value={draft.gateModel ?? ""} onChange={(e) => setDraft((d) => ({ ...d, gateModel: e.target.value }))} className={inputClass} />
          </div>
        </div>

        {mutation.isError && <p className="mb-4 font-mono text-sm text-alert">{(mutation.error as Error).message}</p>}

        <h3 className="mb-2 font-mono text-xs uppercase tracking-widest text-dust">Activity</h3>
        <AiActivity />
      </div>
    </section>
  );
}
