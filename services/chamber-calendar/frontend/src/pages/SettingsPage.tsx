import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { googleConnectHref } from "@congress/congress-ui";
import {
  fetchAccounts,
  fetchAvailableCalendars,
  fetchSelectedCalendars,
  setCalendarSelection,
  fetchSettings,
  updateSettings,
  fetchSyncStatus,
  syncNow,
} from "@/lib/api";
import type { GoogleAccount } from "../../../src/types";

function AccountCalendars({ account }: { account: GoogleAccount }) {
  const queryClient = useQueryClient();

  const { data: available, isLoading } = useQuery({
    queryKey: ["calendars", "available", account.id],
    queryFn: () => fetchAvailableCalendars(account.id),
    enabled: !account.needsReconnect,
  });

  const { data: selected } = useQuery({
    queryKey: ["calendars", "selected"],
    queryFn: fetchSelectedCalendars,
  });

  const toggleMutation = useMutation({
    mutationFn: (args: { googleCalendarId: string; summary: string; colorHex: string | null; selected: boolean }) =>
      setCalendarSelection(account.id, args.googleCalendarId, {
        summary: args.summary,
        colorHex: args.colorHex,
        selected: args.selected,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendars", "selected"] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });

  if (account.needsReconnect) return null;
  if (isLoading) return <p className="pl-4 font-mono text-xs text-dust">Loading calendars —</p>;

  return (
    <div className="pl-4">
      {available?.map((cal) => {
        const isSelected = selected?.some(
          (s) => s.accountId === account.id && s.googleCalendarId === cal.googleCalendarId && s.selected
        );
        return (
          <label key={cal.googleCalendarId} className="flex items-center gap-2 py-1 font-mono text-sm text-slate">
            <input
              type="checkbox"
              checked={Boolean(isSelected)}
              onChange={(e) =>
                toggleMutation.mutate({
                  googleCalendarId: cal.googleCalendarId,
                  summary: cal.summary,
                  colorHex: cal.backgroundColor,
                  selected: e.target.checked,
                })
              }
            />
            {cal.backgroundColor && (
              <span className="h-2.5 w-2.5 shrink-0" style={{ backgroundColor: cal.backgroundColor }} />
            )}
            {cal.summary}
          </label>
        );
      })}
    </div>
  );
}

const RETURN_TO = "/settings?from=calendar";

const SYNC_INTERVALS = [1, 5, 15, 30, 60];

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

function SyncSettings() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const status = useQuery({ queryKey: ["sync-status"], queryFn: fetchSyncStatus, refetchInterval: 30_000 });

  const save = useMutation({
    mutationFn: updateSettings,
    onSuccess: (data) => {
      queryClient.setQueryData(["settings"], data);
      queryClient.invalidateQueries({ queryKey: ["sync-status"] });
    },
  });
  const sync = useMutation({
    mutationFn: syncNow,
    onSuccess: (data) => {
      queryClient.setQueryData(["sync-status"], data);
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });

  const interval = settings.data?.syncIntervalMinutes;
  const lastError = status.data?.lastError;

  return (
    <div className="mb-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-xl text-ink">Sync</h3>
        <button
          type="button"
          onClick={() => sync.mutate()}
          disabled={sync.isPending || status.data?.syncing}
          className="tap-target font-mono text-xs uppercase tracking-wide text-accent hover:underline disabled:text-dust"
        >
          {sync.isPending || status.data?.syncing ? "Syncing —" : "Sync now"}
        </button>
      </div>
      {interval !== undefined && (
        <label className="flex flex-wrap items-center gap-2 font-mono text-sm text-ink">
          Check Google Calendar every
          <select
            value={interval}
            onChange={(e) => save.mutate({ syncIntervalMinutes: Number(e.target.value) })}
            className="border border-dust bg-parchment px-2 py-1 text-base text-ink"
          >
            {(SYNC_INTERVALS.includes(interval) ? SYNC_INTERVALS : [...SYNC_INTERVALS, interval].sort((a, b) => a - b)).map((m) => (
              <option key={m} value={m}>
                {m === 1 ? "minute" : m === 60 ? "hour" : `${m} minutes`}
              </option>
            ))}
          </select>
        </label>
      )}
      {status.data && (
        <p className={`mt-2 font-mono text-xs ${lastError ? "text-alert" : "text-dust"}`}>
          {lastError ? `Last sync had problems: ${lastError}` : `Synced ${timeAgo(status.data.lastSyncedAt)}`}
        </p>
      )}
      {sync.isError && <p className="mt-2 font-mono text-xs text-alert">Sync request failed.</p>}
    </div>
  );
}

export function SettingsPage() {
  const { data: accounts, isLoading, isError } = useQuery({
    queryKey: ["accounts"],
    queryFn: fetchAccounts,
  });

  return (
    <section>
      <SyncSettings />
      <div className="mb-8">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-xl text-ink">Google Accounts</h3>
          <a
            href={googleConnectHref({ returnTo: RETURN_TO })}
            className="font-mono text-xs uppercase tracking-wide text-accent hover:underline"
          >
            + Connect account
          </a>
        </div>
        <p className="mb-3 font-mono text-xs text-dust">Shared with other Chambers - rename or disconnect under Settings → Accounts.</p>

        {isLoading && <p className="font-mono text-sm text-dust">Loading —</p>}
        {isError && <p className="font-mono text-sm text-alert">Failed to reach the Calendar API.</p>}
        {!isLoading && !isError && accounts?.length === 0 && (
          <p className="border-t border-dust px-1 py-3 font-mono text-sm text-dust">
            — No Google accounts connected yet —
          </p>
        )}

        {accounts?.map((account) => (
          <div key={account.id} className="border-t border-dust py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div className="min-w-0">
                <span className="font-display text-lg text-ink">{account.label}</span>{" "}
                <span className="font-mono text-xs text-dust">{account.email}</span>
              </div>
              {(account.needsReconnect || !account.hasAccess) && (
                <a
                  href={googleConnectHref({ returnTo: RETURN_TO, loginHint: account.email })}
                  className="shrink-0 font-mono text-xs uppercase tracking-wide text-accent hover:underline"
                >
                  {account.needsReconnect ? "Reconnect" : "Grant calendar access"}
                </a>
              )}
            </div>
            {account.hasAccess && <AccountCalendars account={account} />}
          </div>
        ))}
      </div>
    </section>
  );
}
