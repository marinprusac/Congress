// The Banks connector's panel API (server: src/connectors/enablebanking).

const BASE = "/congress/connectors/enablebanking";

export interface BankConnection {
  sessionId: string;
  bank: string;
  country: string;
  validUntil: string;
  status: "active" | "revoked";
  accounts: { uid: string; name: string; iban: string | null; currency: string }[];
}

export interface BanksStatus {
  hasCredentials: boolean;
  appId: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  connections: BankConnection[];
}

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, { ...init, headers: { "Content-Type": "application/json" } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const fetchBanksStatus = () => send<BanksStatus>("/status");
export const saveBanksCredentials = (appId: string, privateKey: string) => send<{ hasCredentials: true }>("/settings", { method: "PUT", body: JSON.stringify({ appId, privateKey }) });
export const fetchBanks = (country: string) => send<{ name: string; country: string }[]>(`/banks?country=${encodeURIComponent(country)}`);
export const connectBank = (bank: string, country: string) => send<{ url: string }>("/connect", { method: "POST", body: JSON.stringify({ bank, country, origin: window.location.origin }) });
export const disconnectBank = (sessionId: string) => send<{ ok: true }>(`/connections/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
