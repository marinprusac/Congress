import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchPairing, startPairing, type PairingSnapshot } from "@/lib/api";
import { qrPath } from "@/lib/format";

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
