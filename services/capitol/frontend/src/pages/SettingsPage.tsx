import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCapitolSettings, updateCapitolSettings, capitolSettingsQueryKey, fetchRegistry } from "@congress/exhibit-ui";
import { CapitolHeader } from "@/components/CapitolHeader";

function WidgetVisibilitySection() {
  const queryClient = useQueryClient();
  const { data: settings } = useCapitolSettings();
  const { data: registry } = useQuery({ queryKey: ["capitol", "registry"], queryFn: fetchRegistry });

  const mutation = useMutation({
    mutationFn: updateCapitolSettings,
    onSuccess: (updated) => queryClient.setQueryData(capitolSettingsQueryKey(), updated),
  });

  if (!settings || !registry) return null;
  const hidden = new Set(settings.hiddenWidgets);

  function toggle(name: string, visible: boolean) {
    const next = new Set(hidden);
    if (visible) next.delete(name);
    else next.add(name);
    mutation.mutate({ hiddenWidgets: [...next] });
  }

  return (
    <div className="mt-6">
      <p className="font-mono text-xs uppercase tracking-wide text-dust">Homepage widgets</p>
      <p className="mt-1 font-mono text-xs text-dust">Choose which Chambers show a widget on the Capitol homepage.</p>
      <div className="mt-3 flex flex-col gap-2">
        {registry.map((chamber) => (
          <label key={chamber.name} className="flex items-center gap-2 font-mono text-sm text-ink">
            <input
              type="checkbox"
              checked={!hidden.has(chamber.name)}
              onChange={(e) => toggle(chamber.name, e.target.checked)}
            />
            {chamber.displayName}
          </label>
        ))}
        {registry.length === 0 && <p className="font-mono text-xs text-dust">— No Chambers registered —</p>}
      </div>
    </div>
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
    <div className="min-h-screen bg-parchment text-ink capitol-shell">
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

        <WidgetVisibilitySection />
      </main>
    </div>
  );
}
