import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader, FormLabel, FormTextInput, showToast, useAutosave } from "@congress/congress-ui";
import { fetchSettings, updateSettings, fetchPollHealth, reprocessHistory } from "@/lib/api";

interface SettingsDraft {
  unknownClusterRadiusMeters: number;
  minDwellMinutes: number;
  stoppedSpeedKmh: number;
  pollIntervalSeconds: number;
  staleThresholdHours: number;
}

const DEFAULT_DRAFT: SettingsDraft = {
  unknownClusterRadiusMeters: 150,
  minDwellMinutes: 15,
  stoppedSpeedKmh: 3,
  pollIntervalSeconds: 120,
  staleThresholdHours: 12,
};

export function SettingsPage() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const healthQuery = useQuery({ queryKey: ["poll-health"], queryFn: fetchPollHealth, refetchInterval: 30000 });

  const [draft, setDraft] = useState<SettingsDraft>(DEFAULT_DRAFT);

  const mutation = useMutation({
    mutationFn: (d: SettingsDraft) =>
      updateSettings({
        unknownClusterRadiusMeters: d.unknownClusterRadiusMeters,
        minDwellMs: d.minDwellMinutes * 60000,
        stoppedSpeedKmh: d.stoppedSpeedKmh,
        pollIntervalMs: d.pollIntervalSeconds * 1000,
        staleThresholdMs: d.staleThresholdHours * 3600000,
      }),
    onSuccess: (updated) => queryClient.setQueryData(["settings"], updated),
    onError: () => showToast("Failed to save settings.", "error"),
  });

  // Loads the draft exactly once - a background refetch (e.g. the health
  // panel's own poll) must never stomp an in-progress edit.
  const initializedRef = useRef(false);
  const { markSaved } = useAutosave({
    value: draft,
    enabled: initializedRef.current,
    onSave: (d) => mutation.mutate(d),
  });
  useEffect(() => {
    if (settingsQuery.data && !initializedRef.current) {
      const loaded: SettingsDraft = {
        unknownClusterRadiusMeters: settingsQuery.data.unknownClusterRadiusMeters,
        minDwellMinutes: Math.round(settingsQuery.data.minDwellMs / 60000),
        stoppedSpeedKmh: settingsQuery.data.stoppedSpeedKmh,
        pollIntervalSeconds: Math.round(settingsQuery.data.pollIntervalMs / 1000),
        staleThresholdHours: settingsQuery.data.staleThresholdMs / 3600000,
      };
      setDraft(loaded);
      markSaved(loaded);
      initializedRef.current = true;
    }
  }, [settingsQuery.data, markSaved]);

  // Two-step rather than a browser confirm(): a rebuild throws away every
  // derived visit and trip and recomputes them, so it shouldn't fire on one
  // stray tap - but it's also recoverable (the position log it reads from is
  // never touched), so it doesn't warrant a modal either.
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const rebuild = useMutation({
    mutationFn: () => reprocessHistory(),
    onSuccess: (result) => {
      setConfirmRebuild(false);
      queryClient.invalidateQueries({ queryKey: ["visits"] });
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      showToast(`Rebuilt ${result.visitsCreated} visits and ${result.tripsCreated} trips`);
    },
    onError: () => {
      setConfirmRebuild(false);
      showToast("Rebuild failed.", "error");
    },
  });

  const health = healthQuery.data;

  return (
    <section>
      <PageHeader title="Settings" />

      <div className="mb-10">
        <FormLabel>Unknown-location cluster radius (meters)</FormLabel>
        <FormTextInput
          type="number"
          min={10}
          value={draft.unknownClusterRadiusMeters}
          onChange={(e) => setDraft((d) => ({ ...d, unknownClusterRadiusMeters: Number(e.target.value) }))}
        />
        <p className="-mt-3 mb-4 font-mono text-xs text-dust">How close two unmatched fixes must be to count as the same unrecognized spot.</p>

        <FormLabel>Minimum dwell before asking about a spot (minutes)</FormLabel>
        <FormTextInput
          type="number"
          min={1}
          value={draft.minDwellMinutes}
          onChange={(e) => setDraft((d) => ({ ...d, minDwellMinutes: Number(e.target.value) }))}
        />
        <p className="-mt-3 mb-4 font-mono text-xs text-dust">
          A shorter stop than this never shows up on the Pending page - it's treated as a quick stop, not a place worth naming.
        </p>

        <FormLabel>Stopped-speed threshold (km/h)</FormLabel>
        <FormTextInput
          type="number"
          min={0.5}
          step={0.5}
          value={draft.stoppedSpeedKmh}
          onChange={(e) => setDraft((d) => ({ ...d, stoppedSpeedKmh: Number(e.target.value) }))}
        />
        <p className="-mt-3 mb-4 font-mono text-xs text-dust">
          Below this speed an unmatched fix counts as "stopped somewhere" instead of transit. Raise it if a slow drive keeps
          opening spurious pending visits; lower it if genuine stops (e.g. walking) are being missed.
        </p>

        <FormLabel>Traccar poll interval (seconds)</FormLabel>
        <FormTextInput
          type="number"
          min={15}
          value={draft.pollIntervalSeconds}
          onChange={(e) => setDraft((d) => ({ ...d, pollIntervalSeconds: Number(e.target.value) }))}
        />
        <p className="-mt-3 mb-4 font-mono text-xs text-dust">
          How often this Chamber asks Traccar for new fixes. Only helps if your device is actually reporting more often than
          this - it can't recover location the device itself never sent.
        </p>

        <FormLabel>Stale-tracking alert (hours)</FormLabel>
        <FormTextInput
          type="number"
          min={1}
          step={1}
          value={draft.staleThresholdHours}
          onChange={(e) => setDraft((d) => ({ ...d, staleThresholdHours: Number(e.target.value) }))}
        />
        <p className="-mt-3 mb-4 font-mono text-xs text-dust">
          If the device hasn't sent a real position in this long, a Traccar poll can still succeed with nothing new to show
          for it - a phone-side issue (permissions, background refresh, the tracker app closed), not something this Chamber
          can recover from. Fires a notification via the Logs Chamber instead of leaving it to be noticed as missing visits.
        </p>
      </div>

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

      <div className="mt-10 border-t border-dust pt-6">
        <p className="mb-3 font-mono text-xs uppercase tracking-wide text-dust">Rebuild history</p>
        <p className="mb-4 font-mono text-xs text-dust">
          Recomputes every visit and trip from the stored GPS log using the settings above and the places as they exist now.
          Adding or moving a place already does this for the stretch it affects — run it by hand after changing a threshold
          here, so past days are read the same way new ones will be. Your own labels and ignored spots are carried across;
          the GPS log itself is never modified.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => (confirmRebuild ? rebuild.mutate() : setConfirmRebuild(true))}
            disabled={rebuild.isPending}
            className="tap-target border border-dust px-3 py-2 font-mono text-sm uppercase tracking-wide text-ink hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {rebuild.isPending ? "Rebuilding —" : confirmRebuild ? "Tap again to confirm" : "Rebuild history"}
          </button>
          {confirmRebuild && !rebuild.isPending && (
            <button
              type="button"
              onClick={() => setConfirmRebuild(false)}
              className="tap-target font-mono text-sm text-dust hover:text-ink"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
