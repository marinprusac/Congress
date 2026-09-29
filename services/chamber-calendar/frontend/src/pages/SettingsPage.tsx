import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { googleConnectHref } from "@congress/congress-ui";
import {
  fetchAccounts,
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

const RETURN_TO = "/settings?from=calendar";

export function SettingsPage() {
  const { data: accounts, isLoading, isError } = useQuery({
    queryKey: ["accounts"],
    queryFn: fetchAccounts,
  });

  return (
    <section>
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
