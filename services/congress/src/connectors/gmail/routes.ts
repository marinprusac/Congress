import { Hono } from "hono";
import { z } from "zod";
import { sql } from "drizzle-orm";
import type { ConnectorContext } from "../contract.js";
import { canModify, canRead } from "./api.js";
import { getSettings, listAccountStates, updateSettings } from "./cache.js";
import { gmailDb as db } from "./db/client.js";
import { threads } from "./db/schema.js";
import { attachmentBytes } from "./detail.js";

const settingsInput = z.object({ includeAllCategories: z.boolean().optional() });

// The setup panel's API (Settings → Connectors) and attachment downloads.
export function gmailPanelRoutes(ctx: ConnectorContext): Hono {
  const app = new Hono();

  app.get("/status", (c) => {
    const states = new Map(listAccountStates().map((r) => [r.accountId, r]));
    const counts = new Map(
      db
        .select({ accountId: threads.accountId, n: sql<number>`count(*)` })
        .from(threads)
        .groupBy(threads.accountId)
        .all()
        .map((r) => [r.accountId, Number(r.n)])
    );
    return c.json({
      accounts: ctx.google.accounts().map((a) => ({
        id: a.id,
        label: a.label || a.email,
        hasAccess: canRead(a.scopes),
        canMarkRead: canModify(a.scopes),
        needsReconnect: a.needsReconnect,
        threads: counts.get(a.id) ?? 0,
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

  app.get("/attachments/:accountId/:messageId/:attachmentId", async (c) => {
    try {
      const data = await attachmentBytes(ctx, Number(c.req.param("accountId")), c.req.param("messageId"), c.req.param("attachmentId"));
      const filename = (c.req.query("filename") ?? "attachment").replace(/["\r\n]/g, "");
      return new Response(new Uint8Array(data), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, max-age=3600",
        },
      });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502);
    }
  });

  return app;
}
