import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormLabel, FormSubmitButton, FormErrorMessage } from "@congress/congress-ui";
import { fetchSettings, updateSettings } from "@/lib/api";

const inputClass =
  "w-full border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent";

export function SettingsPage() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });

  const [checkIntervalMinutes, setCheckIntervalMinutes] = useState("");

  useEffect(() => {
    if (settingsQuery.data) setCheckIntervalMinutes(String(Math.round(settingsQuery.data.checkIntervalMs / 60_000)));
  }, [settingsQuery.data]);

  const mutation = useMutation({
    mutationFn: (minutes: number) => updateSettings({ checkIntervalMs: minutes * 60_000 }),
    onSuccess: (updated) => queryClient.setQueryData(["settings"], updated),
  });

  if (settingsQuery.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (settingsQuery.isError || !settingsQuery.data) return <p className="font-mono text-sm text-alert">Failed to reach the settings API.</p>;

  return (
    <section>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const minutes = Number(checkIntervalMinutes);
          if (minutes > 0) mutation.mutate(minutes);
        }}
      >
        <FormLabel>Due/overdue checkup interval (minutes)</FormLabel>
        <input
          type="number"
          min={1}
          value={checkIntervalMinutes}
          onChange={(e) => setCheckIntervalMinutes(e.target.value)}
          className={`${inputClass} mb-1 max-w-40`}
        />
        <p className="mb-4 font-mono text-xs text-dust">
          How often Tasks re-scans open tasks and publishes tasks.due_soon/tasks.overdue/tasks.due_cleared events for a rule or automation
          to act on.
        </p>

        {mutation.isError && <FormErrorMessage>{(mutation.error as Error).message}</FormErrorMessage>}

        <FormSubmitButton disabled={!(Number(checkIntervalMinutes) > 0) || mutation.isPending}>
          {mutation.isPending ? "Saving —" : "Save Settings"}
        </FormSubmitButton>
      </form>
    </section>
  );
}
