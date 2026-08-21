import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader, FormLabel, FormTextInput, FormSubmitButton, showToast } from "@congress/congress-ui";
import { fetchSettings, updateSettings, fetchPollHealth } from "@/lib/api";

export function SettingsPage() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const healthQuery = useQuery({ queryKey: ["poll-health"], queryFn: fetchPollHealth, refetchInterval: 30000 });

  const [unknownClusterRadiusMeters, setUnknownClusterRadiusMeters] = useState(150);
  const [minDwellMinutes, setMinDwellMinutes] = useState(45);

  useEffect(() => {
    if (settingsQuery.data) {
      setUnknownClusterRadiusMeters(settingsQuery.data.unknownClusterRadiusMeters);
      setMinDwellMinutes(Math.round(settingsQuery.data.minDwellMs / 60000));
    }
  }, [settingsQuery.data]);

  const mutation = useMutation({
    mutationFn: () => updateSettings({ unknownClusterRadiusMeters, minDwellMs: minDwellMinutes * 60000 }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["settings"], updated);
      showToast("Settings saved");
    },
    onError: () => showToast("Failed to save settings.", "error"),
  });

  const health = healthQuery.data;

  return (
    <section>
      <PageHeader title="Settings" />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="mb-10"
      >
        <FormLabel>Unknown-location cluster radius (meters)</FormLabel>
        <FormTextInput
          type="number"
          min={10}
          value={unknownClusterRadiusMeters}
          onChange={(e) => setUnknownClusterRadiusMeters(Number(e.target.value))}
        />
        <p className="-mt-3 mb-4 font-mono text-xs text-dust">How close two unmatched fixes must be to count as the same unrecognized spot.</p>

        <FormLabel>Minimum dwell before asking about a spot (minutes)</FormLabel>
        <FormTextInput type="number" min={1} value={minDwellMinutes} onChange={(e) => setMinDwellMinutes(Number(e.target.value))} />
        <p className="-mt-3 mb-4 font-mono text-xs text-dust">
          A shorter stop than this never shows up on the Pending page - it's treated as a quick stop, not a place worth naming.
        </p>

        <FormSubmitButton disabled={mutation.isPending}>{mutation.isPending ? "Saving —" : "Save Settings"}</FormSubmitButton>
      </form>

      <div className="border-t border-dust pt-6">
        <p className="mb-3 font-mono text-xs uppercase tracking-wide text-dust">Traccar polling health</p>
        {healthQuery.isLoading && <p className="font-mono text-sm text-dust">Loading —</p>}
        {health && (
          <dl className="grid grid-cols-1 gap-2 font-mono text-sm text-ink sm:grid-cols-2">
            <dt className="text-dust">Last processed fix</dt>
            <dd>{health.lastProcessedAt ? new Date(health.lastProcessedAt).toLocaleString() : "— never —"}</dd>
            <dt className="text-dust">Last successful poll</dt>
            <dd>{health.lastPollSucceededAt ? new Date(health.lastPollSucceededAt).toLocaleString() : "— never —"}</dd>
            <dt className="text-dust">Last error</dt>
            <dd className={health.lastPollError ? "text-alert" : ""}>{health.lastPollError ?? "— none —"}</dd>
          </dl>
        )}
      </div>
    </section>
  );
}
