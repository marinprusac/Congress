import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showToast } from "@congress/congress-ui";
import type { ConnectorStatus } from "@/lib/connectorsListApi";
import { fetchLocationStatus, rebuildHistory, saveTraccar, saveTrackingSettings } from "@/views/map/api";
import type { TrackingSettings } from "@/views/map/types";

const MIN = 60_000;
const fail = (err: Error) => showToast(err.message, "error");

// Traccar (the phone's tracker), the tracking tunables, and a full rebuild.
export function LocationPanel({ status }: { status: ConnectorStatus }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["connectors", "location"], queryFn: fetchLocationStatus, refetchInterval: 60_000, enabled: status.state === "active" });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["connectors", "location"] });
  const [traccar, setTraccar] = useState({ url: "", token: "", deviceId: "" });
  const saveT = useMutation({
    mutationFn: () => saveTraccar({ url: traccar.url.trim(), token: traccar.token.trim(), deviceId: Number(traccar.deviceId) }),
    onSuccess: () => {
      setTraccar({ url: "", token: "", deviceId: "" });
      showToast("Traccar saved");
    },
    onSettled: refresh,
    onError: fail,
  });
  const saveS = useMutation({ mutationFn: saveTrackingSettings, onSettled: refresh, onError: fail });
  const rebuild = useMutation({
    mutationFn: rebuildHistory,
    onSuccess: (r) => showToast(`Rebuilt: ${r.visitsCreated} visits, ${r.annotationsRestored} labels kept${r.annotationsLost ? `, ${r.annotationsLost} lost` : ""}`),
    onError: fail,
  });

  if (status.state === "offline") return <p className="font-mono text-sm text-alert">Offline: {status.lastError}</p>;
  const s = data?.settings;
  const number = (key: keyof TrackingSettings, label: string, scale = 1, unit = "") =>
    s && (
      <label className="flex items-center justify-between gap-3">
        <span>{label}</span>
        <span className="flex items-center gap-1">
          <input
            type="number"
            defaultValue={Math.round(s[key] / scale)}
            onBlur={(e) => Number(e.target.value) > 0 && Number(e.target.value) * scale !== s[key] && saveS.mutate({ [key]: Number(e.target.value) * scale })}
            className="w-20 border border-dust bg-parchment px-1 py-0.5 text-right text-ink"
          />
          {unit}
        </span>
      </label>
    );

  return (
    <div className="space-y-3 font-mono text-xs text-slate">
      <p>
        {data?.traccar ? `Following device ${data.traccar.deviceId} on ${data.traccar.url}` : "Not tracking yet: connect Traccar below."}
        {data?.poll.lastProcessedAt && ` · last fix ${new Date(data.poll.lastProcessedAt).toLocaleString()}`}
      </p>
      {data?.poll.lastPollError && <p className="break-words text-alert">{data.poll.lastPollError}</p>}
      <form
        className="grid grid-cols-1 gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          saveT.mutate();
        }}
      >
        <input placeholder="Traccar URL" value={traccar.url} onChange={(e) => setTraccar({ ...traccar, url: e.target.value })} className="min-w-0 border border-dust bg-parchment px-2 py-1.5 text-sm text-ink placeholder:text-dust" />
        <input placeholder="Token" type="password" autoComplete="off" value={traccar.token} onChange={(e) => setTraccar({ ...traccar, token: e.target.value })} className="min-w-0 border border-dust bg-parchment px-2 py-1.5 text-sm text-ink placeholder:text-dust" />
        <div className="flex items-center gap-2">
          <input placeholder="Device id" inputMode="numeric" value={traccar.deviceId} onChange={(e) => setTraccar({ ...traccar, deviceId: e.target.value })} className="min-w-0 flex-1 border border-dust bg-parchment px-2 py-1.5 text-sm text-ink placeholder:text-dust" />
          <button type="submit" disabled={!traccar.url || !traccar.token || !Number(traccar.deviceId) || saveT.isPending} className="tap-target uppercase tracking-wide text-accent disabled:text-dust">
            Save
          </button>
        </div>
      </form>
      {s && (
        <div className="space-y-1.5 border-t border-dust pt-2">
          {number("minDwellMs", "A stop counts after", MIN, "min")}
          {number("unknownClusterRadiusMeters", "Stop radius", 1, "m")}
          {number("stoppedSpeedKmh", "Stopped below", 1, "km/h")}
          {number("pollIntervalMs", "Check every", MIN, "min")}
          {number("staleThresholdMs", "Warn when silent for", MIN * 60, "h")}
        </div>
      )}
      <button type="button" disabled={rebuild.isPending} onClick={() => rebuild.mutate()} className="tap-target uppercase tracking-wide text-accent hover:underline disabled:text-dust">
        {rebuild.isPending ? "Rebuilding —" : "Rebuild history"}
      </button>
    </div>
  );
}
