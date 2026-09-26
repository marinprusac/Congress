import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UpdateAiSettingsRequest } from "@congress/shared-types";
import { FormLabel, useAutosave, fetchAiSettings, aiSettingsQueryKey } from "@congress/congress-ui";
import { aiSpendQueryKey, fetchAiSpend, updateAiSettings } from "@/lib/aiApi";

const inputClass =
  "w-full border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent";

// Settings -> AI: the one pause switch and daily budget shared by the chat
// and every Chamber's remote runs (e.g. Deputy's directives), plus the
// context handed to every run. Moved in from Deputy's own Settings tab.
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
        chatIdleWindowMs: s.chatIdleWindowMs,
        budgetCapUsd: s.budgetCapUsd,
        model: s.model,
        retentionDays: s.retentionDays,
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
          placeholder="Handed to every run, chat or Deputy. e.g. Be terse. Always double-check before anything irreversible."
          className={`${inputClass} mb-4`}
        />

        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <FormLabel>Chat idle window (minutes)</FormLabel>
            <input
              type="number"
              min={1}
              value={draft.chatIdleWindowMs != null ? Math.round(draft.chatIdleWindowMs / 60_000) : ""}
              onChange={(e) => setDraft((d) => ({ ...d, chatIdleWindowMs: Number(e.target.value) * 60_000 }))}
              className={inputClass}
            />
          </div>
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

        {mutation.isError && <p className="mb-4 font-mono text-sm text-alert">{(mutation.error as Error).message}</p>}
      </div>
    </section>
  );
}
