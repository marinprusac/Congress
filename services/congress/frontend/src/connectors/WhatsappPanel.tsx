import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showToast } from "@congress/congress-ui";
import type { ConnectorStatus } from "@/lib/connectorsListApi";
import { fetchPairing, fetchSettings, fetchStatus, saveSettings, startPairing, type PairingSnapshot } from "@/views/whatsapp/api";
import { qrPath } from "@/views/whatsapp/format";
import "@/views/whatsapp/whatsapp.css";

// Always dark-on-white with a quiet zone, whatever the theme: scanners need it.
function QrCode({ rows }: { rows: string[] }) {
  const size = rows.length + 8;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="wa-qr" role="img" aria-label="WhatsApp pairing code" shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={qrPath(rows, 4)} fill="#000" />
    </svg>
  );
}

// Links this Congress to WhatsApp: a live QR code for the phone to scan.
export function PairingPanel() {
  const queryClient = useQueryClient();
  const pairing = useQuery({
    queryKey: ["pairing"],
    queryFn: fetchPairing,
    refetchInterval: (q) => (q.state.data?.state === "waiting" ? 1500 : false),
  });
  const start = useMutation({
    mutationFn: startPairing,
    onSuccess: (s: PairingSnapshot) => queryClient.setQueryData(["pairing"], s),
  });
  const state = pairing.data?.state ?? "idle";

  useEffect(() => {
    if (state === "success") {
      void queryClient.invalidateQueries({ queryKey: ["status"] });
      void queryClient.invalidateQueries({ queryKey: ["chats"] });
    }
  }, [state, queryClient]);

  if (state === "success") {
    return <div className="wa-pairing"><p className="wa-pairing-lead">Linked. Your chats and history are arriving — this can take a few minutes.</p></div>;
  }

  const rows = pairing.data?.qr;
  return (
    <div className="wa-pairing">
      <p className="wa-pairing-lead">Link WhatsApp to read your messages here. Nothing is ever sent from Congress.</p>
      {state === "waiting" ? (
        rows && rows.length > 0 ? (
          <>
            <QrCode rows={rows} />
            <ol className="wa-pairing-steps">
              <li>On your phone, open WhatsApp → Settings → Linked devices.</li>
              <li>Tap “Link a device” and point the camera at this code.</li>
            </ol>
            <p className="wa-pairing-note">The code refreshes by itself. Your phone can't scan its own screen — open this page on a computer or tablet.</p>
          </>
        ) : (
          <p className="wa-pairing-note">Getting a code —</p>
        )
      ) : (
        <>
          {state === "expired" && <p className="wa-pairing-note">The code expired before it was scanned.</p>}
          {(state === "error" || start.isError) && (
            <p className="wa-pairing-note text-alert">Couldn't start linking{pairing.data?.error ? ` (${pairing.data.error})` : ""}. Try again.</p>
          )}
          <button type="button" className="wa-more" onClick={() => start.mutate()} disabled={start.isPending}>
            {start.isPending ? "Starting —" : state === "expired" ? "Show a new code" : "Link WhatsApp"}
          </button>
        </>
      )}
    </div>
  );
}

// Settings → Connectors: the link, and whether chats you write in create People.
export function WhatsappPanel({ status }: { status: ConnectorStatus }) {
  const queryClient = useQueryClient();
  const reader = useQuery({ queryKey: ["status"], queryFn: fetchStatus, refetchInterval: 15_000, retry: false });
  const settings = useQuery({ queryKey: ["whatsapp", "settings"], queryFn: fetchSettings, enabled: status.state === "active" });
  const save = useMutation({
    mutationFn: saveSettings,
    onSuccess: (s) => queryClient.setQueryData(["whatsapp", "settings"], s),
    onError: (err: Error) => showToast(err.message, "error"),
  });
  if (status.state === "offline") return <p className="font-mono text-sm text-alert">Offline: {status.lastError}</p>;
  const s = settings.data;
  return (
    <div className="space-y-3 font-mono text-xs text-slate">
      {reader.data?.state === "not_paired" ? (
        <PairingPanel />
      ) : (
        <p>{reader.isError ? "The WhatsApp reader isn't running." : reader.data ? `Reader: ${reader.data.state.replace("_", " ")}` : "Checking the reader —"}</p>
      )}
      {s && (
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={s.createPeople} disabled={save.isPending} onChange={(e) => save.mutate(e.target.checked)} className="mt-0.5" />
          <span>
            Make a Person from each 1:1 chat you've written in at least {s.minOwnerMessages} times
            {s.pending > 0 && ` (${s.pending} waiting)`}. Groups and everyone else only link to existing People.
          </span>
        </label>
      )}
    </div>
  );
}
