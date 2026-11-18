import { createPrivateKey, randomBytes } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import type { ConnectorContext } from "../contract.js";
import { BankApiError, createSession, deleteSession, listBanks, signJwt, startAuth } from "./client.js";
import { addPendingAuth, credentials, getBankSettings, getConnection, listAccounts, listConnections, saveConnection, takePendingAuth, updateBankSettings, updateConnection } from "./cache.js";

const DAY = 86_400_000;
const DEFAULT_CONSENT_DAYS = 90;
export const CALLBACK_PATH = "/congress/connectors/enablebanking/hook/callback";

const fail = (c: { json: (b: unknown, s: 400 | 409 | 502) => Response }, err: unknown) => c.json({ error: (err as Error).message }, err instanceof BankApiError && err.status < 500 ? 400 : 502);

// The callback origin comes from the browser, so it must look like this site: https, or localhost for dev.
const originSchema = z.string().url().refine((o) => {
  const u = new URL(o);
  return u.origin === o && (u.protocol === "https:" || u.hostname === "localhost");
}, "origin must be an https origin");

// Setup-panel API.
export function bankPanelRoutes(ctx: ConnectorContext): Hono {
  const app = new Hono();

  app.get("/status", (c) => {
    const s = getBankSettings();
    return c.json({
      hasCredentials: Boolean(s.appId && s.privateKey),
      appId: s.appId,
      lastError: s.lastError,
      consecutiveFailures: s.consecutiveFailures,
      connections: listConnections().map((conn) => ({ ...conn, accounts: listAccounts(conn.sessionId).map((a) => ({ uid: a.uid, name: a.name, iban: a.iban, currency: a.currency })) })),
    });
  });

  app.put("/settings", async (c) => {
    const body = z.object({ appId: z.string().trim().min(1), privateKey: z.string().trim().min(1) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "appId and privateKey are required" }, 400);
    try {
      createPrivateKey(body.data.privateKey);
      signJwt(body.data);
    } catch {
      return c.json({ error: "That isn't a usable RSA private key (PEM)" }, 400);
    }
    updateBankSettings({ appId: body.data.appId, privateKey: body.data.privateKey, lastError: null, consecutiveFailures: 0 });
    return c.json({ hasCredentials: true });
  });

  app.get("/banks", async (c) => {
    const creds = credentials();
    if (!creds) return c.json({ error: "Save the app credentials first" }, 400);
    const country = (c.req.query("country") ?? "").toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) return c.json({ error: "country must be a two-letter code" }, 400);
    try {
      return c.json((await listBanks(creds, country)).map((b) => ({ name: b.name, country: b.country })));
    } catch (err) {
      return fail(c, err);
    }
  });

  // Returns the bank's consent URL; the owner approves there and lands on the callback hook.
  app.post("/connect", async (c) => {
    const creds = credentials();
    if (!creds) return c.json({ error: "Save the app credentials first" }, 400);
    const body = z.object({ bank: z.string().min(1), country: z.string().length(2), origin: originSchema }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bank, country and origin are required" }, 400);
    const country = body.data.country.toUpperCase();
    try {
      const bank = (await listBanks(creds, country)).find((b) => b.name === body.data.bank);
      if (!bank) return c.json({ error: `${body.data.bank} isn't offered in ${country}` }, 400);
      // As long as the bank allows, up to 90 days.
      const maxDays = bank.maximum_consent_validity ? Math.floor(bank.maximum_consent_validity / 86_400) : DEFAULT_CONSENT_DAYS;
      const validUntil = new Date(Date.now() + Math.min(DEFAULT_CONSENT_DAYS, maxDays) * DAY - 60_000).toISOString();
      const state = randomBytes(24).toString("hex");
      addPendingAuth(state, bank.name, country);
      const { url } = await startAuth(creds, { bank: bank.name, country, validUntil, state, redirectUrl: body.data.origin + CALLBACK_PATH });
      return c.json({ url });
    } catch (err) {
      return fail(c, err);
    }
  });

  // Stops reading; the transactions already kept stay.
  app.delete("/connections/:id", async (c) => {
    const conn = getConnection(c.req.param("id"));
    if (!conn) return c.json({ error: "unknown connection" }, 404);
    const creds = credentials();
    if (creds) {
      try {
        await deleteSession(creds, conn.sessionId);
      } catch {
        // Already gone upstream, or unreachable: we stop reading it either way.
      }
    }
    updateConnection(conn.sessionId, { status: "revoked" });
    return c.json({ ok: true });
  });

  return app;
}

// The bank sends the browser back here with ?code&state; no session (the nonce is the proof).
export function bankHooks(ctx: ConnectorContext): Hono {
  const app = new Hono();
  app.get("/callback", async (c) => {
    const back = (result: string) => c.redirect(`/settings?from=accounts&bank=${result}`);
    const state = c.req.query("state");
    const code = c.req.query("code");
    const pending = state ? takePendingAuth(state) : null;
    const creds = credentials();
    if (!pending || !creds) return back("invalid");
    if (!code) return back("denied");
    try {
      const session = await createSession(creds, code);
      saveConnection({
        sessionId: session.session_id,
        bank: session.aspsp.name,
        country: session.aspsp.country,
        validUntil: session.access.valid_until,
        accounts: session.accounts.map((a) => ({ uid: a.uid, name: a.name ?? "", iban: a.account_id?.iban ?? null, currency: a.currency ?? "" })),
      });
      ctx.syncNow();
      return back("connected");
    } catch (err) {
      updateBankSettings({ lastError: (err as Error).message });
      return back("failed");
    }
  });
  return app;
}
