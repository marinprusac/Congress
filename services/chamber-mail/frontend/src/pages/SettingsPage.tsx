import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { googleConnectHref } from "@congress/congress-ui";
import { fetchAccounts, fetchSettings, syncNow, updateSettings } from "@/lib/api";

const RETURN_TO = "/settings?from=mail";

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const settings = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });

  const sync = useMutation({
    mutationFn: syncNow,
    onSuccess: (data) => queryClient.setQueryData(["accounts"], data),
  });
  const save = useMutation({
    mutationFn: updateSettings,
    onSuccess: (data) => queryClient.setQueryData(["settings"], data),
  });

  return (
    <section className="space-y-8">
      <div>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-xl text-ink">Google Accounts</h3>
          <div className="flex gap-4 font-mono text-xs uppercase tracking-wide">
            <button type="button" onClick={() => sync.mutate()} disabled={sync.isPending} className="tap-target text-slate hover:underline">
              {sync.isPending ? "Syncing —" : "Sync now"}
            </button>
            <a href={googleConnectHref({ returnTo: RETURN_TO })} className="tap-target text-accent hover:underline">
              + Connect
            </a>
          </div>
        </div>
        <p className="mb-3 font-mono text-xs text-dust">Mail reads Gmail and marks threads read when you open them - it never sends or deletes. Accounts are shared with other Chambers - rename or disconnect them under Settings → Accounts.</p>

        {accounts.isLoading && <p className="font-mono text-sm text-dust">Loading —</p>}
        {accounts.isError && <p className="font-mono text-sm text-alert">Failed to reach the Mail API.</p>}
        {accounts.data?.length === 0 && (
          <p className="border-t border-dust px-1 py-3 font-mono text-sm text-dust">— No Google accounts connected yet —</p>
        )}
        {accounts.data?.map((account) => (
          <div key={account.id} className="border-t border-dust py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div className="min-w-0">
                <span className="font-display text-lg text-ink">{account.label}</span>{" "}
                <span className="font-mono text-xs text-dust">{account.email}</span>
              </div>
              {(account.needsReconnect || !account.canMarkRead) && (
                <a
                  href={googleConnectHref({ returnTo: RETURN_TO, loginHint: account.email })}
                  className="tap-target shrink-0 font-mono text-xs uppercase tracking-wide text-accent hover:underline"
                >
                  {account.needsReconnect ? "Reconnect" : account.hasAccess ? "Grant read-sync" : "Grant Gmail access"}
                </a>
              )}
            </div>
            {account.hasAccess && !account.needsReconnect && (
              <p className={`mt-1 font-mono text-xs ${account.lastError ? "text-alert" : "text-dust"}`}>
                {account.lastError ? `Sync failed: ${account.lastError}` : `Synced ${timeAgo(account.lastSyncedAt)}`}
              </p>
            )}
          </div>
        ))}
      </div>

      {settings.data && (
        <div className="space-y-4">
          <h3 className="font-display text-xl text-ink">Feed</h3>
          <label className="flex items-start gap-2 font-mono text-sm text-ink">
            <input
              type="checkbox"
              className="mt-1"
              checked={settings.data.includeAllCategories}
              onChange={(e) => save.mutate({ includeAllCategories: e.target.checked })}
            />
            <span>
              Include every inbox category
              <span className="block text-xs text-dust">Promotions, Social, Updates and Forums too - in the home feed and for "Mail received" events. Off: Primary only.</span>
            </span>
          </label>
          <label className="flex flex-wrap items-center gap-2 font-mono text-sm text-ink">
            Show unread mail from the last
            <select
              value={settings.data.feedWindowHours}
              onChange={(e) => save.mutate({ feedWindowHours: Number(e.target.value) })}
              className="border border-dust bg-parchment px-2 py-1 text-base text-ink"
            >
              {[6, 12, 24, 48, 72, 168].map((h) => (
                <option key={h} value={h}>
                  {h < 48 ? `${h} hours` : `${h / 24} days`}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </section>
  );
}
