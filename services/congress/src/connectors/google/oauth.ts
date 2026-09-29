import type { GoogleClientConfig } from "./config.js";

// Needed for the id_token (the account's stable sub + email).
export const BASE_SCOPES = ["openid", "email"];

export class RevokedTokenError extends Error {
  constructor() {
    super("Google refresh token is no longer valid");
    this.name = "RevokedTokenError";
  }
}

export interface TokenResult {
  accessToken: string;
  refreshToken: string | undefined;
  scope: string;
  expiryMs: number;
  idToken: string | undefined;
}

export function buildAuthUrl(config: GoogleClientConfig, state: string, scopes: string[], loginHint?: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: [...new Set([...BASE_SCOPES, ...scopes])].join(" "),
    access_type: "offline",
    // Consent every time so Google always returns a refresh token for the full scope set.
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  if (loginHint) params.set("login_hint", loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(config: GoogleClientConfig, code: string): Promise<TokenResult> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
      code,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    scope: string;
    expires_in: number;
    id_token?: string;
  };
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    scope: body.scope,
    expiryMs: Date.now() + body.expires_in * 1000,
    idToken: body.id_token,
  };
}

export function decodeIdToken(idToken: string): { sub: string; email: string } {
  const payloadSegment = idToken.split(".")[1];
  if (!payloadSegment) throw new Error("Malformed id_token");
  const payload = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8")) as { sub: string; email: string };
  return { sub: payload.sub, email: payload.email };
}

export async function refreshAccessToken(
  config: GoogleClientConfig,
  refreshToken: string
): Promise<{ accessToken: string; expiryMs: number }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (body.error === "invalid_grant") throw new RevokedTokenError();
    throw new Error(`Token refresh failed: 400 ${body.error ?? ""}`);
  }
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  return { accessToken: body.access_token, expiryMs: Date.now() + body.expires_in * 1000 };
}

export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: "POST",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // best-effort: local disconnect proceeds regardless
  }
}

const STATE_TTL_MS = 10 * 60 * 1000;
const pendingStates = new Map<string, { createdAt: number; returnTo: string }>();

function pruneExpiredStates(): void {
  const now = Date.now();
  for (const [state, entry] of pendingStates) {
    if (now - entry.createdAt > STATE_TTL_MS) pendingStates.delete(state);
  }
}

export function createOAuthState(returnTo: string): string {
  pruneExpiredStates();
  const state = crypto.randomUUID();
  pendingStates.set(state, { createdAt: Date.now(), returnTo });
  return state;
}

// The returnTo the flow started with, or null for an unknown/expired state.
export function consumeOAuthState(state: string): string | null {
  pruneExpiredStates();
  const entry = pendingStates.get(state);
  pendingStates.delete(state);
  return entry ? entry.returnTo : null;
}

// Only same-origin shell paths - never an open redirect.
export function safeReturnTo(value: string | undefined, fallback: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  return value;
}
