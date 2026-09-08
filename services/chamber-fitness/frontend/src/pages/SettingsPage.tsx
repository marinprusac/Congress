import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader, FormLabel, FormTextInput, showToast, useAutosave } from "@congress/congress-ui";
import { fetchSettings, updateSettings, fetchSyncHealth, triggerSync } from "@/lib/api";

export function SettingsPage() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const healthQuery = useQuery({ queryKey: ["sync-health"], queryFn: fetchSyncHealth, refetchInterval: 30000 });

  const [hevyApiKey, setHevyApiKey] = useState("");
  const [healthIngestToken, setHealthIngestToken] = useState("");

  const mutation = useMutation({
    mutationFn: (key: string) => updateSettings({ hevyApiKey: key.trim() || null }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["settings"], updated);
      queryClient.invalidateQueries({ queryKey: ["sync-health"] });
    },
    onError: () => showToast("Failed to save settings.", "error"),
  });

  const tokenMutation = useMutation({
    mutationFn: (token: string) => updateSettings({ healthIngestToken: token.trim() || null }),
    onSuccess: (updated) => queryClient.setQueryData(["settings"], updated),
    onError: () => showToast("Failed to save settings.", "error"),
  });

  // Loads the key exactly once - a background refetch (e.g. the sync-health
  // panel's own poll) must never stomp an in-progress edit.
  const initializedRef = useRef(false);
  const { markSaved } = useAutosave({
    value: hevyApiKey,
    enabled: initializedRef.current,
    onSave: (key) => mutation.mutate(key),
  });
  useEffect(() => {
    if (settingsQuery.data && !initializedRef.current) {
      const key = settingsQuery.data.hevyApiKey ?? "";
      setHevyApiKey(key);
      markSaved(key);
      initializedRef.current = true;
    }
  }, [settingsQuery.data, markSaved]);

  // Independent from the Hevy key's own autosave block above - the two
  // fields save separately, each PUT carrying only the one field that
  // changed (updateSettingsRequestSchema treats both as optional for
  // exactly this reason).
  const tokenInitializedRef = useRef(false);
  const { markSaved: markTokenSaved } = useAutosave({
    value: healthIngestToken,
    enabled: tokenInitializedRef.current,
    onSave: (token) => tokenMutation.mutate(token),
  });
  useEffect(() => {
    if (settingsQuery.data && !tokenInitializedRef.current) {
      const token = settingsQuery.data.healthIngestToken ?? "";
      setHealthIngestToken(token);
      markTokenSaved(token);
      tokenInitializedRef.current = true;
    }
  }, [settingsQuery.data, markTokenSaved]);

  const sync = useMutation({
    mutationFn: () => triggerSync(),
    onSuccess: (health) => {
      queryClient.setQueryData(["sync-health"], health);
      queryClient.invalidateQueries({ queryKey: ["workouts"] });
      showToast("Sync complete");
    },
    onError: () => showToast("Sync failed.", "error"),
  });

  const health = healthQuery.data;

  return (
    <section>
      <PageHeader title="Settings" />

      <div className="mb-10">
        <FormLabel>Hevy API key</FormLabel>
        <FormTextInput
          type="password"
          autoComplete="off"
          placeholder="Requires a Hevy Pro subscription"
          value={hevyApiKey}
          onChange={(e) => setHevyApiKey(e.target.value)}
        />
        <p className="-mt-3 mb-4 font-mono text-xs text-dust">
          Found in the Hevy app under Settings → API. Clear this field to stop syncing.
        </p>
      </div>

      <div className="mb-10 border-t border-dust pt-6">
        <FormLabel>Health ingest token</FormLabel>
        <FormTextInput
          type="password"
          autoComplete="off"
          placeholder="Paste a generated token, then use it as the Shortcut's header value"
          value={healthIngestToken}
          onChange={(e) => setHealthIngestToken(e.target.value)}
        />
        <p className="-mt-3 mb-4 font-mono text-xs text-dust">
          Set as the X-Health-Ingest-Token header in your iOS Shortcut's request to /api/fitness/health/ingest.
          Generate a long random value (e.g. from a password manager) rather than typing your own. Clear this
          field to reject all incoming Shortcuts requests.
        </p>
      </div>

      <div className="border-t border-dust pt-6">
        <p className="mb-3 font-mono text-xs uppercase tracking-wide text-dust">Hevy sync health</p>
        {healthQuery.isLoading && <p className="font-mono text-sm text-dust">Loading —</p>}
        {health && (
          <dl className="grid grid-cols-1 gap-2 font-mono text-sm text-ink sm:grid-cols-2">
            <dt className="text-dust">Last synced</dt>
            <dd>{health.lastSyncedAt ? new Date(health.lastSyncedAt).toLocaleString() : "— never —"}</dd>
            <dt className="text-dust">Last error</dt>
            <dd className={health.lastError ? "text-alert" : ""}>{health.lastError ?? "— none —"}</dd>
          </dl>
        )}
        <button
          type="button"
          onClick={() => sync.mutate()}
          disabled={sync.isPending}
          className="tap-target mt-4 border border-dust px-3 py-2 font-mono text-sm uppercase tracking-wide text-ink hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {sync.isPending ? "Syncing —" : "Sync now"}
        </button>
      </div>
    </section>
  );
}
