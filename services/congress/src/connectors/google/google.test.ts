import { sql } from "drizzle-orm";
import { migrationsDir } from "@congress/test-support";
import { GoogleAccountNeedsReconnectError, GoogleScopeMissingError, defineChamber } from "@congress/chamber-kit";
import { Hono } from "hono";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../events.js", () => ({ publishEvent: vi.fn() }));
vi.mock("./oauth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./oauth.js")>()),
  refreshAccessToken: vi.fn(),
  revokeToken: vi.fn(async () => {}),
}));

import { db, runMigrations } from "../../db/client.js";
import { googleAccounts } from "../../db/schema.js";
import { publishEvent } from "../../events.js";
import { addModule, removeModule } from "../../chambers/runtime.js";
import { resolveGoogleClientConfig, setGoogleClientConfigForTests } from "./config.js";
import { refreshAccessToken, RevokedTokenError, safeReturnTo, consumeOAuthState, createOAuthState, buildAuthUrl } from "./oauth.js";
import {
  disconnectAccount,
  getAccessToken,
  googleConnectorStatus,
  importLegacyAccounts,
  requestedScopes,
  upsertAccountFromOAuth,
} from "./accounts.js";

const GMAIL = "https://www.googleapis.com/auth/gmail.readonly";
const CAL = "https://www.googleapis.com/auth/calendar.events";
const config = { clientId: "cid", clientSecret: "secret", redirectUri: "https://c.example/congress/connectors/google/callback" };

beforeAll(() => runMigrations(migrationsDir("congress")));

beforeEach(() => {
  db.run(sql`delete from google_accounts`);
  vi.mocked(publishEvent).mockReset();
  vi.mocked(refreshAccessToken).mockReset();
  setGoogleClientConfigForTests(config);
});

afterEach(() => setGoogleClientConfigForTests(undefined));

function insert(id: number, opts: { scope?: string; expiry?: Date; needsReconnect?: boolean } = {}) {
  db.insert(googleAccounts)
    .values({
      id,
      label: `Account ${id}`,
      email: `a${id}@example.com`,
      googleSub: `sub-${id}`,
      accessToken: `at-${id}`,
      refreshToken: `rt-${id}`,
      scope: opts.scope ?? `openid ${CAL}`,
      tokenExpiry: opts.expiry ?? new Date(Date.now() + 3600_000),
      needsReconnect: opts.needsReconnect ?? false,
      connectedAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
}

function fakeChamber(name: string, googleScopes: string[]) {
  return defineChamber({
    manifest: { name, displayName: name.toUpperCase(), version: "1", routes: { home: `/${name}`, settings: `/${name}/settings` }, views: [], exhibitTypes: [], events: [], googleScopes },
    app: new Hono(),
    registerTools: () => {},
    dir: "/tmp",
    initEnv: () => {},
    start: () => {},
    stop: () => {},
  });
}

describe("resolveGoogleClientConfig", () => {
  it("prefers Congress's own vars", () => {
    expect(
      resolveGoogleClientConfig(
        { GOOGLE_OAUTH_CLIENT_ID: "own", GOOGLE_OAUTH_CLIENT_SECRET: "s", GOOGLE_OAUTH_REDIRECT_URI: "https://x/cb" },
        { GOOGLE_OAUTH_CLIENT_ID: "cal", GOOGLE_OAUTH_CLIENT_SECRET: "c", GOOGLE_OAUTH_REDIRECT_URI: "https://y/cb" }
      )
    ).toEqual({ clientId: "own", clientSecret: "s", redirectUri: "https://x/cb" });
  });

  it("falls back to the Calendar credentials with the connector's callback on the same origin", () => {
    expect(
      resolveGoogleClientConfig(
        {},
        {
          GOOGLE_OAUTH_CLIENT_ID: "cal",
          GOOGLE_OAUTH_CLIENT_SECRET: "c",
          GOOGLE_OAUTH_REDIRECT_URI: "https://congress.example/api/calendar/oauth/google/callback",
        }
      )
    ).toEqual({ clientId: "cal", clientSecret: "c", redirectUri: "https://congress.example/congress/connectors/google/callback" });
  });

  it("is unconfigured without a client id/secret", () => {
    expect(resolveGoogleClientConfig({ GOOGLE_OAUTH_CLIENT_ID: "" }, {})).toBeNull();
  });
});

describe("OAuth helpers", () => {
  it("only allows same-origin return paths", () => {
    expect(safeReturnTo("/settings?from=mail", "/x")).toBe("/settings?from=mail");
    expect(safeReturnTo("//evil.com", "/x")).toBe("/x");
    expect(safeReturnTo("https://evil.com", "/x")).toBe("/x");
    expect(safeReturnTo("/\\evil.com", "/x")).toBe("/x");
    expect(safeReturnTo(undefined, "/x")).toBe("/x");
  });

  it("states are single use and carry their return path", () => {
    const state = createOAuthState("/mail/settings");
    expect(consumeOAuthState(state)).toBe("/mail/settings");
    expect(consumeOAuthState(state)).toBeNull();
  });

  it("asks for incremental consent with the base scopes and a login hint", () => {
    const url = new URL(buildAuthUrl(config, "st", [GMAIL, "openid"], "me@example.com"));
    expect(url.searchParams.get("scope")).toBe(`openid email ${GMAIL}`);
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("login_hint")).toBe("me@example.com");
    expect(url.searchParams.get("access_type")).toBe("offline");
  });
});

describe("getAccessToken", () => {
  it("returns a still-valid token without refreshing", async () => {
    insert(1);
    await expect(getAccessToken(1, [CAL])).resolves.toBe("at-1");
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("refuses scopes the account hasn't granted", async () => {
    insert(1);
    await expect(getAccessToken(1, [CAL, GMAIL])).rejects.toMatchObject({ name: "GoogleScopeMissingError", missing: [GMAIL] });
    await expect(getAccessToken(1, [GMAIL])).rejects.toBeInstanceOf(GoogleScopeMissingError);
  });

  it("refreshes an expired token once for concurrent callers", async () => {
    insert(1, { expiry: new Date(0) });
    let resolve!: (v: { accessToken: string; expiryMs: number }) => void;
    vi.mocked(refreshAccessToken).mockReturnValue(new Promise((r) => (resolve = r)));
    const a = getAccessToken(1, [CAL]);
    const b = getAccessToken(1, [CAL]);
    resolve({ accessToken: "fresh", expiryMs: Date.now() + 3600_000 });
    await expect(Promise.all([a, b])).resolves.toEqual(["fresh", "fresh"]);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    await expect(getAccessToken(1, [CAL])).resolves.toBe("fresh");
  });

  it("flags a revoked account and publishes needs_reconnect only once", async () => {
    insert(1, { expiry: new Date(0) });
    vi.mocked(refreshAccessToken).mockRejectedValue(new RevokedTokenError());
    await expect(getAccessToken(1, [CAL])).rejects.toBeInstanceOf(GoogleAccountNeedsReconnectError);
    await expect(getAccessToken(1, [CAL])).rejects.toBeInstanceOf(GoogleAccountNeedsReconnectError);
    const types = vi.mocked(publishEvent).mock.calls.map((c) => c[0].type);
    expect(types).toEqual(["google.account_needs_reconnect"]);
  });
});

describe("accounts", () => {
  it("re-consent widens scopes on the same account and keeps the refresh token", () => {
    insert(3);
    upsertAccountFromOAuth({ sub: "sub-3", email: "a3@example.com", accessToken: "n", refreshToken: undefined, scope: `openid ${CAL} ${GMAIL}`, expiryMs: Date.now() + 1000 });
    const row = db.select().from(googleAccounts).all();
    expect(row).toHaveLength(1);
    expect(row[0]).toMatchObject({ id: 3, refreshToken: "rt-3", scope: `openid ${CAL} ${GMAIL}` });
  });

  it("disconnect publishes google.account_disconnected", async () => {
    insert(1);
    await expect(disconnectAccount(1)).resolves.toBe(true);
    expect(vi.mocked(publishEvent).mock.calls[0]![0]).toMatchObject({ type: "google.account_disconnected", payload: { accountId: 1 } });
  });

  it("imports legacy accounts keeping free ids and matching known subs", () => {
    insert(1);
    const now = new Date();
    const legacy = (id: number, sub: string) => ({
      id,
      label: "L",
      email: "l@example.com",
      googleSub: sub,
      accessToken: "a",
      refreshToken: "r",
      scope: CAL,
      tokenExpiry: now,
      needsReconnect: false,
      connectedAt: now,
    });
    const map = importLegacyAccounts([legacy(5, "sub-1"), legacy(2, "new-2"), legacy(1, "new-1")]);
    expect(map.get(5)).toBe(1);
    expect(map.get(2)).toBe(2);
    expect(map.get(1)).not.toBe(1);
    expect(db.select().from(googleAccounts).all()).toHaveLength(3);
  });
});

describe("googleConnectorStatus", () => {
  afterEach(() => {
    removeModule("cal");
    removeModule("mail");
  });

  it("unions every Chamber's scopes and lists what each account is missing", () => {
    addModule(fakeChamber("cal", [CAL]));
    addModule(fakeChamber("mail", [GMAIL]));
    insert(1);
    expect(requestedScopes().sort()).toEqual([CAL, GMAIL].sort());
    const status = googleConnectorStatus();
    expect(status.configured).toBe(true);
    expect(status.accounts[0]!.missing).toEqual([{ chamber: "mail", displayName: "MAIL", scopes: [GMAIL] }]);
  });
});

describe("connector routes and the SameSite=Strict session", () => {
  const app = new Hono();
  beforeAll(async () => {
    app.route("/c", (await import("./routes.js")).googleConnectorRoutes);
  });

  it("keeps every route but the callback behind the session", async () => {
    expect((await app.request("/c/")).status).toBe(401);
    expect((await app.request("/c/start")).status).toBe(401);
  });

  it("lets Google's cross-site callback through without the cookie, authorised by its state alone", async () => {
    expect((await app.request("/c/callback?state=forged&code=x")).status).toBe(400);
    const state = createOAuthState("/settings");
    const res = await app.request(`/c/callback?state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/settings");
    // Single use.
    expect((await app.request(`/c/callback?state=${state}`)).status).toBe(400);
  });
});
