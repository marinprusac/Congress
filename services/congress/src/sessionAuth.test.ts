import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TEST_INTERNAL_TOKEN, TEST_MASTER_PASSWORD } from "@congress/test-support";
import { authRoutes, requireSession } from "./sessionAuth.js";
import { requireInternalToken, requireSessionOrInternalToken } from "./auth.js";

const app = new Hono<{ Bindings: HttpBindings }>();
app.route("/auth", authRoutes);
app.get("/gated", requireSession, (c) => c.json({ ok: true }));
app.get("/internal", requireInternalToken, (c) => c.json({ ok: true }));
app.get("/either", requireSessionOrInternalToken, (c) => c.json({ ok: true }));

// clientIp falls back to the node-server binding when there is no
// x-forwarded-for, which app.request() does not provide on its own.
function bindings(remoteAddress = "10.0.0.1") {
  return { incoming: { socket: { remoteAddress } } } as unknown as HttpBindings;
}

async function login(password: string, ip: string) {
  return app.request(
    "/auth/login",
    { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ password }) },
    bindings()
  );
}

function cookieFrom(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("expected a Set-Cookie header");
  return setCookie.split(";")[0]!;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /auth/login", () => {
  it("rejects a wrong password without issuing a cookie", async () => {
    const res = await login("wrong", "1.1.1.1");
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "invalid_password" });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("rejects an empty or missing password", async () => {
    expect((await login("", "1.1.1.2")).status).toBe(401);
    const res = await app.request(
      "/auth/login",
      { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "1.1.1.3" }, body: "{}" },
      bindings()
    );
    expect(res.status).toBe(401);
  });

  it("rejects a non-JSON body rather than throwing", async () => {
    const res = await app.request(
      "/auth/login",
      { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "1.1.1.4" }, body: "nonsense" },
      bindings()
    );
    expect(res.status).toBe(401);
  });

  it("issues a hardened session cookie for the right password", async () => {
    const res = await login(TEST_MASTER_PASSWORD, "1.1.1.5");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ authenticated: true });

    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toContain("congress_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Max-Age=2592000");
  });
});

describe("session cookie", () => {
  it("reports an unauthenticated status with no cookie", async () => {
    await expect((await app.request("/auth/status", {}, bindings())).json()).resolves.toEqual({ authenticated: false });
  });

  it("round-trips: a cookie from login authenticates a later request", async () => {
    const cookie = cookieFrom(await login(TEST_MASTER_PASSWORD, "2.2.2.1"));
    await expect((await app.request("/auth/status", { headers: { cookie } }, bindings())).json()).resolves.toEqual({
      authenticated: true,
    });
  });

  it("opens a session-gated route", async () => {
    const cookie = cookieFrom(await login(TEST_MASTER_PASSWORD, "2.2.2.2"));
    expect((await app.request("/gated", { headers: { cookie } }, bindings())).status).toBe(200);
  });

  it("401s a session-gated route with no cookie", async () => {
    expect((await app.request("/gated", {}, bindings())).status).toBe(401);
  });

  it("rejects a forged cookie, since the value is signed", async () => {
    // Without the signature check, anyone could set congress_session by hand.
    const res = await app.request("/gated", { headers: { cookie: "congress_session=authenticated" } }, bindings());
    expect(res.status).toBe(401);
  });

  it("rejects a cookie whose signature has been tampered with", async () => {
    const cookie = cookieFrom(await login(TEST_MASTER_PASSWORD, "2.2.2.3"));
    const tampered = `${cookie.slice(0, -2)}xx`;
    expect((await app.request("/gated", { headers: { cookie: tampered } }, bindings())).status).toBe(401);
  });

  it("clears the cookie on logout", async () => {
    const res = await app.request("/auth/logout", { method: "POST" }, bindings());
    await expect(res.json()).resolves.toEqual({ authenticated: false });
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

describe("login throttling", () => {
  // This is a public endpoint on a single-user system with no accounts, so
  // the only thing standing between a scanner and the master password is
  // this per-IP counter.
  it("locks an IP out after five failures and answers 429 rather than 401", async () => {
    const ip = "3.3.3.1";
    for (let i = 0; i < 5; i += 1) expect((await login("wrong", ip)).status).toBe(401);
    expect((await login("wrong", ip)).status).toBe(429);
  });

  it("locks out even a subsequently-correct password, so brute force cannot outrun the counter", async () => {
    const ip = "3.3.3.2";
    for (let i = 0; i < 5; i += 1) await login("wrong", ip);
    const res = await login(TEST_MASTER_PASSWORD, ip);
    expect(res.status).toBe(429);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("throttles per source IP, not globally", async () => {
    const ip = "3.3.3.3";
    for (let i = 0; i < 5; i += 1) await login("wrong", ip);
    expect((await login("wrong", "3.3.3.4")).status).toBe(401);
  });

  it("lets the IP back in once the lockout window has passed", async () => {
    const ip = "3.3.3.5";
    for (let i = 0; i < 5; i += 1) await login("wrong", ip);
    expect((await login("wrong", ip)).status).toBe(429);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 15 * 60 * 1000 + 1);
    expect((await login(TEST_MASTER_PASSWORD, ip)).status).toBe(200);
  });

  it("clears the counter on a successful login", async () => {
    const ip = "3.3.3.6";
    for (let i = 0; i < 4; i += 1) await login("wrong", ip);
    expect((await login(TEST_MASTER_PASSWORD, ip)).status).toBe(200);
    // The four earlier failures are forgotten, so five more are needed again.
    for (let i = 0; i < 5; i += 1) expect((await login("wrong", ip)).status).toBe(401);
    expect((await login("wrong", ip)).status).toBe(429);
  });

  it("uses the first entry of x-forwarded-for, which is the real client behind Caddy", async () => {
    const chain = "4.4.4.1, 10.0.0.5, 10.0.0.6";
    for (let i = 0; i < 5; i += 1) await login("wrong", chain);
    // Same real client, different proxy chain - still the same locked-out IP.
    expect((await login("wrong", "4.4.4.1, 172.16.0.1")).status).toBe(429);
  });

  it("falls back to the socket address when there is no x-forwarded-for", async () => {
    const attempt = () =>
      app.request(
        "/auth/login",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "wrong" }) },
        bindings("5.5.5.1")
      );
    for (let i = 0; i < 5; i += 1) expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(429);
  });
});

describe("requireInternalToken", () => {
  it("accepts the shared secret", async () => {
    const res = await app.request("/internal", { headers: { "X-Congress-Internal-Token": TEST_INTERNAL_TOKEN } });
    expect(res.status).toBe(200);
  });

  it("401s a missing or wrong token", async () => {
    expect((await app.request("/internal")).status).toBe(401);
    expect((await app.request("/internal", { headers: { "X-Congress-Internal-Token": "nope" } })).status).toBe(401);
  });

  it("does not accept a session cookie in place of the token", async () => {
    const cookie = cookieFrom(await login(TEST_MASTER_PASSWORD, "6.6.6.1"));
    expect((await app.request("/internal", { headers: { cookie } }, bindings())).status).toBe(401);
  });
});

describe("requireSessionOrInternalToken", () => {
  it("accepts the internal token", async () => {
    const res = await app.request("/either", { headers: { "X-Congress-Internal-Token": TEST_INTERNAL_TOKEN } });
    expect(res.status).toBe(200);
  });

  it("accepts a session cookie", async () => {
    const cookie = cookieFrom(await login(TEST_MASTER_PASSWORD, "6.6.6.2"));
    expect((await app.request("/either", { headers: { cookie } }, bindings())).status).toBe(200);
  });

  it("401s with neither", async () => {
    expect((await app.request("/either", {}, bindings())).status).toBe(401);
  });
});
