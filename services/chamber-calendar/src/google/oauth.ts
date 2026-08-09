import { env } from "../env.js";

export const SCOPES = [
  // openid + email are needed so Google's token response includes an
  // id_token — that's how we learn the account's stable sub/email to key
  // the upsert, not for any authentication purpose of our own.
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

export class RevokedTokenError extends Error {
  constructor() {
    super("Google refresh token is no longer valid");
    this.name = "RevokedTokenError";
  }
}

interface TokenResult {
  accessToken: string;
  refreshToken: string | undefined;
  scope: string;
  expiryMs: number;
  idToken: string | undefined;
}

interface RefreshResult {
  accessToken: string;
  expiryMs: number;
}

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<TokenResult> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI,
      grant_type: "authorization_code",
      code,
    }),
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  }
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
  const payload = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8")) as {
    sub: string;
    email: string;
  };
  return { sub: payload.sub, email: payload.email };
}

export async function refreshAccessToken(refreshToken: string): Promise<RefreshResult> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (body.error === "invalid_grant") {
      throw new RevokedTokenError();
    }
  }
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  }
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
const pendingStates = new Map<string, number>();

function pruneExpiredStates(): void {
  const now = Date.now();
  for (const [state, createdAt] of pendingStates) {
    if (now - createdAt > STATE_TTL_MS) pendingStates.delete(state);
  }
}

export function createOAuthState(): string {
  pruneExpiredStates();
  const state = crypto.randomUUID();
  pendingStates.set(state, Date.now());
  return state;
}

export function consumeOAuthState(state: string): boolean {
  pruneExpiredStates();
  return pendingStates.delete(state);
}
