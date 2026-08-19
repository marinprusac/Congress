import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchAccounts,
  disconnectAccount,
  connectAccountUrl,
  fetchAvailableCalendars,
  fetchSelectedCalendars,
  setCalendarSelection,
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

export function SettingsPage() {
  const queryClient = useQueryClient();

  const { data: accounts, isLoading, isError } = useQuery({
    queryKey: ["accounts"],
    queryFn: fetchAccounts,
  });

  const disconnectMutation = useMutation({
    mutationFn: (id: number) => disconnectAccount(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["calendars", "selected"] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });

  return (
    <section>
      <div className="mb-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="font-display text-xl text-ink">Connected Accounts</h3>
          <a
            href={connectAccountUrl()}
            className="font-mono text-xs uppercase tracking-wide text-accent hover:underline"
          >
            + Connect a Google Account
          </a>
        </div>

        {isLoading && <p className="font-mono text-sm text-dust">Loading —</p>}
        {isError && <p className="font-mono text-sm text-alert">Failed to reach the Calendar API.</p>}
        {!isLoading && !isError && accounts?.length === 0 && (
          <p className="border-t border-dust px-1 py-3 font-mono text-sm text-dust">
            — No Google accounts connected yet —
          </p>
        )}

        {accounts?.map((account) => (
          <div key={account.id} className="border-t border-dust py-3">
            <div className="flex items-baseline justify-between gap-4">
              <div>
                <span className="font-display text-lg text-ink">{account.label}</span>{" "}
                <span className="font-mono text-xs text-dust">{account.email}</span>
                {account.needsReconnect && (
                  <span className="ml-2 font-mono text-xs uppercase text-alert">Needs reconnect</span>
                )}
              </div>
              <div className="flex shrink-0 gap-3 font-mono text-xs uppercase tracking-wide">
                {account.needsReconnect && (
                  <a href={connectAccountUrl()} className="text-accent hover:underline">
                    Reconnect
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => disconnectMutation.mutate(account.id)}
                  className="text-alert hover:underline"
                >
                  Disconnect
                </button>
              </div>
            </div>
            <AccountCalendars account={account} />
          </div>
        ))}
      </div>
    </section>
  );
}
