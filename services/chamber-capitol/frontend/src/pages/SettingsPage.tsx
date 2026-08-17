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
      )}

      <div className="mt-10 border-t border-dust pt-6">
        <SignOutControl />
      </div>
    </section>
  );
}
