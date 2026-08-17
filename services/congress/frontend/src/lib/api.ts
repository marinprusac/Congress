import type { ShareSummary } from "@congress/shared-types";

export async function fetchAuthStatus(): Promise<{ authenticated: boolean }> {
  const res = await fetch("/auth/status");
  if (!res.ok) return { authenticated: false };
  return res.json();
}

export async function login(password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (res.ok) return { ok: true };
  if (res.status === 429) return { ok: false, error: "Too many attempts. Try again later." };
  return { ok: false, error: "Incorrect passphrase." };
}

export async function logout(): Promise<void> {
  await fetch("/auth/logout", { method: "POST" });
}

export async function fetchShares(): Promise<ShareSummary[]> {
  const res = await fetch("/capitol/shares");
  if (!res.ok) throw new Error(`Failed to fetch shares: ${res.status}`);
  const data = (await res.json()) as { shares: ShareSummary[] };
  return data.shares;
}

export async function revokeShare(token: string): Promise<void> {
  const res = await fetch(`/capitol/shares/${encodeURIComponent(token)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to revoke share: ${res.status}`);
}
