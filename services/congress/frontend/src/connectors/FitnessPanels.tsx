import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showToast } from "@congress/congress-ui";
import { syncConnector, type ConnectorStatus } from "@/lib/connectorsListApi";
import { fetchHealthStatus, fetchHevyStatus, newHealthToken, saveHevyKey } from "@/lib/fitnessApi";
import { syncedAgo } from "./syncedAgo";

const fail = (err: Error) => showToast(err.message, "error");

export function HevyPanel({ status }: { status: ConnectorStatus }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["connectors", "hevy"], queryFn: fetchHevyStatus, refetchInterval: 30_000, enabled: status.state === "active" });
  const [key, setKey] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["connectors"] });
  const sync = useMutation({ mutationFn: () => syncConnector(status.name), onSettled: refresh, onError: fail });
  const save = useMutation({ mutationFn: saveHevyKey, onSuccess: () => setKey(""), onSettled: refresh, onError: fail });

  if (status.state === "offline") return <p className="font-mono text-sm text-alert">Offline: {status.lastError}</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 font-mono text-xs text-slate">
        <span>{status.syncing || sync.isPending ? "Syncing —" : syncedAgo(status.lastSyncedAt)}</span>
        <button type="button" disabled={sync.isPending || !data?.hasKey} onClick={() => sync.mutate()} className="tap-target uppercase tracking-wide text-accent hover:underline disabled:text-dust">
          Sync now
        </button>
      </div>
      {data?.lastError && <p className="break-words font-mono text-xs text-alert">{data.lastError}</p>}
      {data && <p className="font-mono text-xs text-dust">{data.workouts} workouts · {data.routines} routines</p>}
      <form
        className="flex min-w-0 items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim()) save.mutate(key.trim());
        }}
      >
        <input
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={data?.hasKey ? "API key set — paste a new one" : "Hevy API key"}
          className="min-w-0 flex-1 border border-dust bg-parchment px-2 py-1.5 font-mono text-sm text-ink placeholder:text-dust"
        />
        <button type="submit" disabled={!key.trim() || save.isPending} className="tap-target shrink-0 font-mono text-xs uppercase tracking-wide text-accent disabled:text-dust">
          Save
        </button>
      </form>
    </div>
  );
}

export function HealthPanel({ status }: { status: ConnectorStatus }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["connectors", "health"], queryFn: fetchHealthStatus, refetchInterval: 30_000, enabled: status.state === "active" });
  const [token, setToken] = useState<string | null>(null);
  const rotate = useMutation({
    mutationFn: newHealthToken,
    onSuccess: (res) => setToken(res.token),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["connectors", "health"] }),
    onError: fail,
  });
  if (status.state === "offline") return <p className="font-mono text-sm text-alert">Offline: {status.lastError}</p>;
  const url = `${window.location.origin}/api/fitness/health/ingest`;
  return (
    <div className="space-y-2 font-mono text-xs text-slate">
      {data && (
        <p>
          {data.samples} samples · {data.lastIngestAt ? `last received ${new Date(data.lastIngestAt).toLocaleString()}` : "nothing received yet"}
        </p>
      )}
      <p className="break-all text-dust">
        Health Auto Export posts to <span className="text-ink">{url}</span> with the header X-Health-Ingest-Token.
      </p>
      {token && (
        <p className="break-all text-ink">
          New token (shown once): <span className="select-all">{token}</span>
        </p>
      )}
      <button
        type="button"
        disabled={rotate.isPending}
        onClick={() => rotate.mutate()}
        className="tap-target uppercase tracking-wide text-accent hover:underline disabled:text-dust"
      >
        {data?.hasToken ? "Replace token" : "Make a token"}
      </button>
    </div>
  );
}
