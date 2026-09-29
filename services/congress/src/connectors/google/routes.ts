import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { updateGoogleAccountRequestSchema } from "@congress/shared-types";
import { requireSession } from "../../sessionAuth.js";
import { googleClientConfig } from "./config.js";
import { buildAuthUrl, consumeOAuthState, createOAuthState, decodeIdToken, exchangeCodeForTokens, safeReturnTo } from "./oauth.js";
import {
  disconnectAccount,
  googleConnectorStatus,
  requestedScopes,
  updateAccountLabel,
  upsertAccountFromOAuth,
} from "./accounts.js";

const SETTINGS_PATH = "/settings?from=accounts";

// Mounted at /congress/connectors/google.
export const googleConnectorRoutes = new Hono<{ Bindings: HttpBindings }>();

// The callback arrives cross-site from Google, where the SameSite=Strict
// session cookie isn't sent; its single-use state (only minted by the
// session-gated /start) authorises it instead.
googleConnectorRoutes.use("*", (c, next) => (c.req.path.endsWith("/callback") ? next() : requireSession(c, next)));

googleConnectorRoutes.get("/", (c) => c.json(googleConnectorStatus()));

googleConnectorRoutes.patch("/accounts/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const parsed = updateGoogleAccountRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  const account = updateAccountLabel(id, parsed.data.label);
  if (!account) return c.json({ error: "not_found" }, 404);
  return c.json(account);
});

googleConnectorRoutes.delete("/accounts/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  if (!(await disconnectAccount(id))) return c.json({ error: "not_found" }, 404);
  return c.body(null, 204);
});

// Always asks for every Chamber's scopes, so one consent covers them all.
googleConnectorRoutes.get("/start", (c) => {
  const config = googleClientConfig();
  if (!config) return c.json({ error: "google_not_configured" }, 503);
  const state = createOAuthState(safeReturnTo(c.req.query("returnTo"), SETTINGS_PATH));
  return c.redirect(buildAuthUrl(config, state, requestedScopes(), c.req.query("loginHint") || undefined));
});

googleConnectorRoutes.get("/callback", async (c) => {
  const config = googleClientConfig();
  if (!config) return c.json({ error: "google_not_configured" }, 503);
  const state = c.req.query("state");
  const returnTo = state ? consumeOAuthState(state) : null;
  if (!returnTo) return c.json({ error: "invalid_oauth_callback" }, 400);
  const code = c.req.query("code");
  if (!code) return c.redirect(returnTo);
  try {
    const tokens = await exchangeCodeForTokens(config, code);
    if (!tokens.idToken) return c.json({ error: "missing_id_token" }, 502);
    const { sub, email } = decodeIdToken(tokens.idToken);
    upsertAccountFromOAuth({ sub, email, ...tokens });
    return c.redirect(returnTo);
  } catch (err) {
    console.error("Google OAuth callback failed:", err);
    return c.json({ error: "oauth_failed" }, 502);
  }
});
