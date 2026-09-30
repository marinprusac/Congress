import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showToast } from "@congress/congress-ui";
import {
  fetchCalendarPanel,
  refreshCalendarList,
  saveCalendarSettings,
  selectCalendar,
  syncConnector,
  type ConnectorStatus,
} from "@/lib/connectorsListApi";
import { syncedAgo } from "./syncedAgo";

const PANEL_KEY = ["connectors", "google-calendar"];
const INTERVALS = [1, 5, 15, 30, 60];

export function GoogleCalendarPanel({ status }: { status: ConnectorStatus }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: PANEL_KEY, queryFn: fetchCalendarPanel, refetchInterval: 30_000, enabled: status.state === "active" });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["connectors"] });
  const fail = (err: Error) => showToast(err.message, "error");

  const sync = useMutation({ mutationFn: () => syncConnector(status.name), onSettled: refresh, onError: fail });
  const settings = useMutation({ mutationFn: saveCalendarSettings, onSettled: refresh, onError: fail });
  const select = useMutation({
    mutationFn: (v: { accountId: number; calendarId: string; selected: boolean }) => selectCalendar(v.accountId, v.calendarId, v.selected),
    onSettled: refresh,
    onError: fail,
  });
  const list = useMutation({ mutationFn: refreshCalendarList, onSettled: refresh, onError: fail });

  if (status.state === "offline") {
    return <p className="font-mono text-sm text-alert">Offline: {status.lastError}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 font-mono text-xs text-slate">
        <span>{status.syncing || sync.isPending ? "Syncing —" : syncedAgo(status.lastSyncedAt)}</span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1">
            every
            <select
              className="field-plain font-mono text-xs"
              value={data?.settings.intervalMinutes ?? 5}
              onChange={(e) => settings.mutate({ intervalMinutes: Number(e.target.value) })}
            >
              {INTERVALS.map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={sync.isPending} onClick={() => sync.mutate()} className="tap-target uppercase tracking-wide text-accent hover:underline disabled:text-dust">
            Sync now
          </button>
        </div>
      </div>
      {status.lastError && !data?.accounts.some((a) => a.lastError) && <p className="break-words font-mono text-xs text-alert">{status.lastError}</p>}
      {data && (
        <p className="font-mono text-xs text-dust">
          {data.counts.events} events · {data.counts.attendees} guests · {data.counts.people} linked to People
        </p>
      )}

      {data?.accounts.length === 0 && <p className="font-mono text-sm text-dust">Connect a Google account above.</p>}
      {data?.accounts.map((account) => (
        <div key={account.id} className="border-t border-dust pt-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate font-mono text-sm text-ink">{account.label}</span>
            <button
              type="button"
              disabled={list.isPending}
              onClick={() => list.mutate(account.id)}
              className="tap-target shrink-0 font-mono text-xs uppercase tracking-wide text-slate hover:underline disabled:text-dust"
            >
              Refresh list
            </button>
          </div>
          {account.lastError && <p className="break-words font-mono text-xs text-alert">{account.lastError}</p>}
          {account.calendars.length === 0 && <p className="font-mono text-xs text-dust">No calendars listed yet.</p>}
          <ul>
            {account.calendars.map((cal) => (
              <li key={cal.id}>
                <label className="flex min-w-0 items-center gap-2 py-1.5 font-mono text-sm text-ink">
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={cal.selected}
                    onChange={(e) => select.mutate({ accountId: account.id, calendarId: cal.id, selected: e.target.checked })}
                  />
                  <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: cal.color ?? "var(--color-dust)" }} />
                  <span className="min-w-0 truncate">{cal.summary}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <p className="border-t border-dust pt-2 font-mono text-xs text-dust">Guests are linked to People you already have, by email. Calendar never adds People.</p>
    </div>
  );
}
