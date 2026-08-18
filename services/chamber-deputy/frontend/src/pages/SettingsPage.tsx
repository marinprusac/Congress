import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader, FormLabel, useShellHosted, resolveChamberPath } from "@congress/congress-ui";
import { fetchSettings, updateSettings, fetchSpend } from "@/lib/api";
import type { UpdateSettingsRequest } from "../../../src/types";

const inputClass = "w-full border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent";

export function SettingsPage() {
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const spendQuery = useQuery({ queryKey: ["settings", "spend"], queryFn: fetchSpend, refetchInterval: 60_000 });

  const [draft, setDraft] = useState<UpdateSettingsRequest>({});

  useEffect(() => {
    if (settingsQuery.data) {
      const s = settingsQuery.data;
      setDraft({
        personaPrompt: s.personaPrompt,
        checkupIntervalMs: s.checkupIntervalMs,
        chatIdleWindowMs: s.chatIdleWindowMs,
        budgetCapUsd: s.budgetCapUsd,
        model: s.model,
        retentionDays: s.retentionDays,
      });
    }
  }, [settingsQuery.data]);

  const mutation = useMutation({
    mutationFn: (input: UpdateSettingsRequest) => updateSettings(input),
    onSuccess: (updated) => queryClient.setQueryData(["settings"], updated),
  });

  const pauseMutation = useMutation({
    mutationFn: (paused: boolean) => updateSettings({ paused, pausedReason: paused ? "Paused by owner." : null }),
    onSuccess: (updated) => queryClient.setQueryData(["settings"], updated),
  });

  if (settingsQuery.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (settingsQuery.isError || !settingsQuery.data) return <p className="font-mono text-sm text-alert">Failed to reach the settings API.</p>;

  const settings = settingsQuery.data;

  function save() {
    mutation.mutate(draft);
  }

  return (
    <section>
      <PageHeader title="Settings" />

      <div className="mb-6 border border-dust p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-display text-lg text-ink">{settings.paused ? "Paused" : "Active"}</p>
            {settings.paused && settings.pausedReason && <p className="mt-1 font-mono text-xs text-alert">{settings.pausedReason}</p>}
            {spendQuery.data && <p className="mt-1 font-mono text-xs text-dust">Spent today: ${spendQuery.data.spentTodayUsd.toFixed(2)} of ${settings.budgetCapUsd.toFixed(2)}</p>}
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

      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <FormLabel>Persona / tone</FormLabel>
        <textarea
          value={draft.personaPrompt ?? ""}
          onChange={(e) => setDraft((d) => ({ ...d, personaPrompt: e.target.value }))}
          rows={3}
          placeholder="e.g. Be terse. Always double-check before anything irreversible."
          className={`${inputClass} mb-4`}
        />

        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <FormLabel>Checkup interval (minutes)</FormLabel>
            <input
              type="number"
              min={1}
              value={draft.checkupIntervalMs != null ? Math.round(draft.checkupIntervalMs / 60_000) : ""}
              onChange={(e) => setDraft((d) => ({ ...d, checkupIntervalMs: Number(e.target.value) * 60_000 }))}
              className={inputClass}
            />
          </div>
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
            <FormLabel>Run/message retention (days)</FormLabel>
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

        <button
          type="submit"
          disabled={mutation.isPending}
          className="border border-accent px-4 py-2 font-mono text-xs uppercase tracking-wide text-accent hover:bg-accent hover:text-parchment disabled:opacity-50"
        >
          {mutation.isPending ? "Saving —" : "Save Settings"}
        </button>
      </form>

      <p className="mt-8 border-t border-dust pt-4 font-mono text-xs text-dust">
        <Link to={resolveChamberPath("/runs", "deputy", shellHosted)} className="text-accent hover:underline">
          View run history →
        </Link>
      </p>
    </section>
  );
}
