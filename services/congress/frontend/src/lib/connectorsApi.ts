import type { GoogleAccount, GoogleConnectorStatus } from "@congress/shared-types";

const BASE = "/congress/connectors/google";

export async function fetchGoogleConnector(): Promise<GoogleConnectorStatus> {
  const res = await fetch(BASE);
  if (!res.ok) throw new Error(`Failed to load accounts (${res.status})`);
  return res.json();
}

export async function renameGoogleAccount(id: number, label: string): Promise<GoogleAccount> {
  const res = await fetch(`${BASE}/accounts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  });
  if (!res.ok) throw new Error(`Rename failed (${res.status})`);
  return res.json();
}

export async function disconnectGoogleAccount(id: number): Promise<void> {
  const res = await fetch(`${BASE}/accounts/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Disconnect failed (${res.status})`);
}
