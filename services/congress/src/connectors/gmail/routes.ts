import { Hono } from "hono";
import { z } from "zod";
import type { ConnectorContext } from "../contract.js";
import { canRead } from "./api.js";
import { getSettings, listAccountStates, updateSettings } from "./cache.js";

const settingsInput = z.object({ includeAllCategories: z.boolean().optional() });

// The setup panel's API (Settings → Connectors).
export function gmailPanelRoutes(ctx: ConnectorContext): Hono {
  const app = new Hono();

  app.get("/status", (c) => {
    const states = new Map(listAccountStates().map((r) => [r.accountId, r]));
    return c.json({
      accounts: ctx.google.accounts().map((a) => ({
        id: a.id,
        label: a.label || a.email,
        hasAccess: canRead(a.scopes),
        needsReconnect: a.needsReconnect,
        lastSyncedAt: states.get(a.id)?.lastSyncedAt?.toISOString() ?? null,
        lastError: states.get(a.id)?.lastError ?? null,
      })),
      settings: { includeAllCategories: getSettings().includeAllCategories },
    });
  });

  app.put("/settings", async (c) => {
    const body = settingsInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid settings" }, 400);
    const next = updateSettings(body.data);
    return c.json({ includeAllCategories: next.includeAllCategories });
  });

  return app;
}
