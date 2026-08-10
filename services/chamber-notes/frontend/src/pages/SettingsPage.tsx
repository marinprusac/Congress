import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchSettings, updateSettings } from "@/lib/api";

export function SettingsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });

  const mutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: (updated) => queryClient.setQueryData(["settings"], updated),
  });

  return (
    <section>
      <h2 className="mb-6 border-b border-dust pb-4 font-display text-3xl text-ink">Settings</h2>

      {isLoading && <p className="font-mono text-sm text-dust">Loading —</p>}
      {isError && <p className="font-mono text-sm text-alert">Failed to load settings.</p>}

      {data && (
        <div>
          <label className="flex items-center gap-2 font-mono text-sm text-ink">
            <input
              type="checkbox"
              checked={data.autoSave}
              onChange={(e) => mutation.mutate({ autoSave: e.target.checked })}
            />
            Autosave notes while editing
          </label>
          <p className="mt-1 pl-6 font-mono text-xs text-dust">
            When off, edits are saved with the Save button or Ctrl+S.
          </p>
        </div>
      )}
    </section>
  );
}
