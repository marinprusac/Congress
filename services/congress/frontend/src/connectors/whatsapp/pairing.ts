import { parseJsonResponse as json } from "@congress/congress-ui";

// The WhatsApp connector's setup API: the reader's link status and QR pairing.
// Chats aren't read in Congress (the AI reads them); nothing is ever sent.
const API_BASE = "/congress/connectors/whatsapp";

export interface ReaderStatus {
  state: string;
  since: number;
  detail?: string;
  lastEventAt: number;
  lastPhoneAt: number;
}

export interface PairingSnapshot {
  state: "idle" | "waiting" | "success" | "expired" | "error";
  expiresAt?: number;
  qr?: string[];
  error?: string;
}

export const fetchStatus = async () => json<ReaderStatus>(await fetch(`${API_BASE}/status`));
export const fetchPairing = async () => json<PairingSnapshot>(await fetch(`${API_BASE}/pairing`));

// Starts (or rejoins) a QR session on the reader - linking, never sending.
export const startPairing = async () => json<PairingSnapshot>(await fetch(`${API_BASE}/pairing`, { method: "POST" }));

// The QR code's dark modules as one SVG path, offset by the quiet zone.
export function qrPath(rows: string[], quiet: number): string {
  let d = "";
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === "1") d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
  });
  return d;
}
