import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCapitolSettings, capitolSettingsQueryKey, updateCapitolSettings } from "@congress/congress-ui";

function SignOutControl() {
  const queryClient = useQueryClient();

  async function handleSignOut() {
    await fetch("/auth/logout", { method: "POST" });
    queryClient.setQueryData(["auth", "status"], { authenticated: false });
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      className="font-mono text-xs uppercase tracking-wide text-dust hover:text-ink"
    >
      Sign out
    </button>
  );
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useCapitolSettings();

  const mutation = useMutation({
    mutationFn: updateCapitolSettings,
    onSuccess: (updated) => queryClient.setQueryData(capitolSettingsQueryKey(), updated),
  });

  return (
    <section>
      <h2 className="mb-6 font-display text-2xl text-ink">Settings</h2>

      {isLoading && <p className="font-mono text-sm text-dust">Loading —</p>}
      {isError && <p className="font-mono text-sm text-alert">Failed to load settings.</p>}

      {data && (
        <div className="space-y-6">
          <div>
            <label className="flex items-center gap-2 font-mono text-sm text-ink">
              <input
                type="checkbox"
                checked={data.darkMode}
                onChange={(e) => mutation.mutate({ darkMode: e.target.checked })}
              />
              Dark mode
            </label>
            <p className="mt-1 pl-6 font-mono text-xs text-dust">Applies across Congress and every Chamber, on any device.</p>
          </div>

          <div>
            <label className="flex items-center gap-2 font-mono text-sm text-ink">
              Event log retention (hours)
              <input
                type="number"
                min={1}
                defaultValue={Math.round(data.eventRetentionMs / 3_600_000)}
                onBlur={(e) => {
                  const hours = Number(e.target.value);
                  if (hours > 0) mutation.mutate({ eventRetentionMs: hours * 3_600_000 });
                }}
                className="w-20 border border-dust bg-parchment px-2 py-1 font-mono text-sm text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
              />
            </label>
            <p className="mt-1 font-mono text-xs text-dust">
              How long Congress's generic event log keeps a published event before pruning it, when the publishing Chamber
              doesn't declare its own retention for that event type. Chambers polling less often than this (e.g. Deputy's
              own checkup interval) may miss events published between polls if this is too short.
            </p>
          </div>
        </div>
      )}

      <div className="mt-10 border-t border-dust pt-6">
        <SignOutControl />
      </div>
    </section>
  );
}
