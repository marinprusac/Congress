import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCapitolSettings, updateCapitolSettings, capitolSettingsQueryKey } from "@congress/exhibit-ui";
import { CapitolHeader } from "@/components/CapitolHeader";

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useCapitolSettings();

  const mutation = useMutation({
    mutationFn: updateCapitolSettings,
    onSuccess: (updated) => queryClient.setQueryData(capitolSettingsQueryKey(), updated),
  });

  return (
    <div className="min-h-screen bg-parchment text-ink">
      <CapitolHeader />
      <main className="mx-auto max-w-4xl px-6 py-10">
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
            <p className="mt-1 pl-6 font-mono text-xs text-dust">
              Applies across Capitol and every Chamber, on any device.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
