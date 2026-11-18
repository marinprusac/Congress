import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showToast } from "@congress/congress-ui";
import { syncConnector, type ConnectorStatus } from "@/lib/connectorsListApi";
import { connectBank, disconnectBank, fetchBanks, fetchBanksStatus, saveBanksCredentials } from "@/lib/banksApi";
import { syncedAgo } from "./syncedAgo";

const fail = (err: Error) => showToast(err.message, "error");
const input = "min-w-0 border-2 border-ink bg-paper px-2 py-1.5 font-mono text-sm text-ink placeholder:text-dust";

// What the callback reports back in ?bank=.
const RETURNED: Record<string, [string, "error" | "success"]> = {
  connected: ["Bank connected. Reading transactions…", "success"],
  denied: ["The bank connection was cancelled", "error"],
  invalid: ["That bank link expired or was already used. Connect again.", "error"],
  failed: ["The bank connection failed. See the error below.", "error"],
};

export function BanksPanel({ status }: { status: ConnectorStatus }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["connectors", "enablebanking"], queryFn: fetchBanksStatus, refetchInterval: 30_000, enabled: status.state === "active" });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["connectors"] });
  const sync = useMutation({ mutationFn: () => syncConnector(status.name), onSettled: refresh, onError: fail });

  const [appId, setAppId] = useState("");
  const [pem, setPem] = useState("");
  const save = useMutation({ mutationFn: () => saveBanksCredentials(appId.trim(), pem.trim()), onSuccess: () => (setPem(""), setAppId("")), onSettled: refresh, onError: fail });

  const [country, setCountry] = useState("");
  const [bank, setBank] = useState("");
  const banks = useQuery({ queryKey: ["connectors", "enablebanking", "banks", country], queryFn: () => fetchBanks(country), enabled: data?.hasCredentials === true && /^[A-Za-z]{2}$/.test(country), staleTime: 3600_000 });
  const connect = useMutation({ mutationFn: () => connectBank(bank, country), onSuccess: (res) => window.location.assign(res.url), onError: fail });
  const disconnect = useMutation({ mutationFn: disconnectBank, onSettled: refresh, onError: fail });

  // Back from the bank: say how it went, then drop the parameter.
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("bank");
    if (!result) return;
    const [message, kind] = RETURNED[result] ?? RETURNED.failed!;
    showToast(message, kind);
    url.searchParams.delete("bank");
    window.history.replaceState(null, "", url);
    refresh();
  }, []);

  if (status.state === "offline") return <p className="font-mono text-sm text-alert">Offline: {status.lastError}</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 font-mono text-xs text-slate">
        <span>{status.syncing || sync.isPending ? "Syncing —" : syncedAgo(status.lastSyncedAt)}</span>
        <button type="button" disabled={sync.isPending || !data?.hasCredentials} onClick={() => sync.mutate()} className="btn">
          Sync now
        </button>
      </div>
      <p className="font-mono text-xs text-dust">Read-only. Banks allow about 4 automatic reads per account a day, so it syncs every 6 hours.</p>
      {data?.lastError && <p className="whitespace-pre-line break-words font-mono text-xs text-alert">{data.lastError}</p>}

      {data && !data.hasCredentials && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (appId.trim() && pem.trim()) save.mutate();
          }}
        >
          <p className="font-mono text-xs text-slate">Enable Banking app: its id and the private key made with it.</p>
          <input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="Application id" autoComplete="off" className={`${input} w-full`} />
          <textarea value={pem} onChange={(e) => setPem(e.target.value)} placeholder="-----BEGIN PRIVATE KEY-----" rows={4} autoComplete="off" spellCheck={false} className={`${input} w-full`} />
          <button type="submit" disabled={!appId.trim() || !pem.trim() || save.isPending} className="btn">
            Save
          </button>
        </form>
      )}

      {data?.connections.map((c) => {
        const expired = c.status !== "active" || Date.parse(c.validUntil) <= Date.now();
        return (
          <div key={c.sessionId} className="border-t border-dust pt-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate font-mono text-sm text-ink">{c.bank}</span>
              <span className={`shrink-0 font-mono text-xs ${expired ? "text-alert" : "text-dust"}`}>
                {c.status === "revoked" ? "Disconnected" : expired ? "Expired" : `until ${new Date(c.validUntil).toLocaleDateString()}`}
              </span>
            </div>
            {c.accounts.map((a) => (
              <p key={a.uid} className="truncate font-mono text-xs text-slate">
                {a.name || a.iban} · {a.currency}
              </p>
            ))}
            {c.status === "active" && (
              <div className="mt-1 flex gap-2">
                {expired && (
                  <button type="button" className="btn" disabled={connect.isPending} onClick={() => (setCountry(c.country), setBank(c.bank), connect.mutate())}>
                    Reconnect
                  </button>
                )}
                <button type="button" className="btn" disabled={disconnect.isPending} onClick={() => disconnect.mutate(c.sessionId)}>
                  Disconnect
                </button>
              </div>
            )}
          </div>
        );
      })}

      {data?.hasCredentials && (
        <div className="space-y-2 border-t border-dust pt-2">
          <p className="font-mono text-xs text-slate">Connect a bank (re-approve about every 90 days)</p>
          <div className="flex min-w-0 gap-2">
            <input
              value={country}
              onChange={(e) => (setCountry(e.target.value.toUpperCase().slice(0, 2)), setBank(""))}
              placeholder="SE"
              maxLength={2}
              aria-label="Country code"
              className={`${input} w-16 shrink-0 uppercase`}
            />
            <select value={bank} onChange={(e) => setBank(e.target.value)} disabled={!banks.data?.length} aria-label="Bank" className={`${input} flex-1`}>
              <option value="">{banks.isFetching ? "Loading…" : banks.error ? "Couldn't load banks" : "Bank"}</option>
              {banks.data?.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="btn" disabled={!bank || connect.isPending} onClick={() => connect.mutate()}>
            Connect
          </button>
        </div>
      )}
    </div>
  );
}
