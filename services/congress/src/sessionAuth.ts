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

function clientIp(c: { req: { header: (name: string) => string | undefined }; env: HttpBindings }): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
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
}

function recordSuccess(ip: string): void {
  attemptsByIp.delete(ip);
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
  if (isLockedOut(ip)) {
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
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return c.json({ authenticated: true });
});

authRoutes.post("/logout", (c) => {
  deleteCookie(c, COOKIE_NAME, { path: "/" });
  return c.json({ authenticated: false });
});
