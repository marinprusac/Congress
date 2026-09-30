import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { googleConnectHref, showToast } from "@congress/congress-ui";
import { fetchGmailPanel, saveGmailSettings, syncConnector, type ConnectorStatus } from "@/lib/connectorsListApi";
import { syncedAgo } from "./syncedAgo";

const PANEL_KEY = ["connectors", "gmail"];

export function GmailPanel({ status }: { status: ConnectorStatus }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: PANEL_KEY, queryFn: fetchGmailPanel, refetchInterval: 30_000, enabled: status.state === "active" });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["connectors"] });
  const fail = (err: Error) => showToast(err.message, "error");
  const sync = useMutation({ mutationFn: () => syncConnector(status.name), onSettled: refresh, onError: fail });
  const settings = useMutation({ mutationFn: saveGmailSettings, onSettled: refresh, onError: fail });

  if (status.state === "offline") return <p className="font-mono text-sm text-alert">Offline: {status.lastError}</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 font-mono text-xs text-slate">
        <span>{status.syncing || sync.isPending ? "Syncing —" : syncedAgo(status.lastSyncedAt)}</span>
        <button type="button" disabled={sync.isPending} onClick={() => sync.mutate()} className="tap-target uppercase tracking-wide text-accent hover:underline disabled:text-dust">
          Sync now
        </button>
      </div>
      <label className="flex items-start gap-2 font-mono text-xs text-slate">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={data?.settings.includeAllCategories ?? false}
          onChange={(e) => settings.mutate({ includeAllCategories: e.target.checked })}
        />
        <span>Announce mail from every category (Promotions, Social, …), not just Primary</span>
      </label>

      {data?.accounts.length === 0 && <p className="font-mono text-sm text-dust">Connect a Google account above.</p>}
      {data?.accounts.map((a) => (
        <div key={a.id} className="border-t border-dust pt-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate font-mono text-sm text-ink">{a.label}</span>
            <span className="shrink-0 font-mono text-xs text-dust">{a.hasAccess ? `${a.threads} threads` : "No Gmail access"}</span>
          </div>
          {a.lastError && <p className="break-words font-mono text-xs text-alert">{a.lastError}</p>}
          {(!a.hasAccess || !a.canMarkRead || a.needsReconnect) && (
            <p className="font-mono text-xs text-dust">
              {a.hasAccess && !a.canMarkRead ? "Can't mark mail read yet. " : ""}
              <a href={googleConnectHref({ returnTo: "/settings?from=accounts" })} className="uppercase text-accent hover:underline">
                {a.hasAccess ? "Grant access" : "Connect Gmail"}
              </a>
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
