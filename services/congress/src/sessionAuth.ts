import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import type { MiddlewareHandler } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { env } from "./env.js";

const COOKIE_NAME = "congress_session";
const SESSION_VALUE = "authenticated";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

// Congress is a single-user system with no accounts, so login attempts are
// throttled per source IP rather than per account.
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const attemptsByIp = new Map<string, { count: number; lockedUntil: number }>();

// A cap across all IPs, so guessing spread over many addresses is still slow.
// While it's hit, everyone (the owner too) waits out the window.
const MAX_GLOBAL_FAILURES = 30;
let globalFailures: number[] = [];

function recentGlobalFailures(): number {
  const cutoff = Date.now() - LOCKOUT_MS;
  globalFailures = globalFailures.filter((t) => t > cutoff);
  return globalFailures.length;
}

function sha256(input: string): Buffer {
  return createHash("sha256").update(input).digest();
}

function passwordMatches(candidate: string): boolean {
  const candidateHash = sha256(candidate);
  const expectedHash = Buffer.from(env.CONGRESS_MASTER_PASSWORD_HASH, "hex");
  return (
    candidateHash.length === expectedHash.length && timingSafeEqual(candidateHash, expectedHash)
  );
}

// The last X-Forwarded-For entry is the one Caddy added; earlier ones are client-supplied.
function clientIp(c: { req: { header: (name: string) => string | undefined }; env: HttpBindings }): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) return forwarded.split(",").at(-1)!.trim();
  return c.env.incoming.socket.remoteAddress ?? "unknown";
}

function isLockedOut(ip: string): boolean {
  const entry = attemptsByIp.get(ip);
  return entry !== undefined && entry.count >= MAX_ATTEMPTS && Date.now() < entry.lockedUntil;
}

// Entries are only ever added here and removed on a successful login from
// that same IP - on a public endpoint, drive-by scanners from IPs that never
// come back and never succeed would otherwise accumulate for the process's
// whole lifetime. Swept opportunistically on every failure instead of on a
// separate timer - self-bounding to roughly the number of IPs that have
// actually failed within the last lockout window.
function sweepExpiredAttempts(): void {
  const now = Date.now();
  for (const [ip, entry] of attemptsByIp) {
    if (now >= entry.lockedUntil) attemptsByIp.delete(ip);
  }
}

function recordFailure(ip: string): void {
  sweepExpiredAttempts();
  const entry = attemptsByIp.get(ip) ?? { count: 0, lockedUntil: 0 };
  entry.count += 1;
  entry.lockedUntil = Date.now() + LOCKOUT_MS;
  attemptsByIp.set(ip, entry);
  globalFailures.push(Date.now());
}

function recordSuccess(ip: string): void {
  attemptsByIp.delete(ip);
}

// Tests only: forget every failure.
export function resetLoginThrottle(): void {
  attemptsByIp.clear();
  globalFailures = [];
}

export async function hasValidSession(c: Parameters<typeof getSignedCookie>[0]): Promise<boolean> {
  const cookie = await getSignedCookie(c, env.SESSION_SECRET, COOKIE_NAME);
  return cookie === SESSION_VALUE;
}

export const requireSession: MiddlewareHandler<{ Bindings: HttpBindings }> = async (c, next) => {
  if (!(await hasValidSession(c))) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
};

export const authRoutes = new Hono<{ Bindings: HttpBindings }>();

authRoutes.get("/status", async (c) => {
  const cookie = await getSignedCookie(c, env.SESSION_SECRET, COOKIE_NAME);
  return c.json({ authenticated: cookie === SESSION_VALUE });
});

authRoutes.post("/login", async (c) => {
  const ip = clientIp(c);
  if (isLockedOut(ip) || recentGlobalFailures() >= MAX_GLOBAL_FAILURES) {
    return c.json({ error: "too_many_attempts" }, 429);
  }

  const body = await c.req.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";

  if (!password || !passwordMatches(password)) {
    recordFailure(ip);
    return c.json({ error: "invalid_password" }, 401);
  }

  recordSuccess(ip);
  await setSignedCookie(c, COOKIE_NAME, SESSION_VALUE, env.SESSION_SECRET, {
    httpOnly: true,
    secure: true,
    // Strict: never sent on cross-site requests. The shell HTML is public
    // and every data request is same-origin, so nothing needs it cross-site
    // (the Google OAuth callback is authorised by its state instead).
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return c.json({ authenticated: true });
});

authRoutes.post("/logout", (c) => {
  deleteCookie(c, COOKIE_NAME, { path: "/" });
  return c.json({ authenticated: false });
});
