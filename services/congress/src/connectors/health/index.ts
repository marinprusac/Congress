import { randomBytes, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { mcpTextResult } from "@congress/chamber-kit";
import { ConnectorRefusedError, defineConnector } from "../contract.js";
import { closeHealthDb, runHealthMigrations } from "./db/client.js";
import { countMetrics, getHealthSettings, ingestSamples, latestMetrics, listMetrics, updateHealthSettings } from "./store.js";
import { normalizeHealthAutoExportPayload } from "./normalize.js";
import { healthIngestRequestSchema, healthMetricTypeSchema } from "./types.js";

const refuse = () => Promise.reject(new ConnectorRefusedError("Health metrics are read-only"));

function tokenMatches(given: string | undefined): boolean {
  const expected = getHealthSettings().ingestToken;
  if (!given || !expected) return false;
  const [a, b] = [Buffer.from(given), Buffer.from(expected)];
  return a.length === b.length && timingSafeEqual(a, b);
}

// Apple Health, pushed in by Health Auto Export: a time series behind the
// Health view and the AI's tools. Nothing here is a record.
export const healthConnector = defineConnector({
  name: "health",
  label: "Apple Health",
  source: [],
  events: [
    { type: "fitness.health_metric_received", label: "Health data received", description: "New or changed Apple Health samples arrived.", payloadFields: { count: { type: "number" } } },
  ],
  start: () => runHealthMigrations(),
  stop: () => closeHealthDb(),
  sync: async () => ({ changed: 0, error: null }),
  intervalMs: () => 24 * 3_600_000,
  read: {
    get: () => null,
    list: () => [],
    series(kind, opts) {
      const type = healthMetricTypeSchema.safeParse(kind);
      if (!type.success) return [];
      return listMetrics({ metricType: type.data, from: opts.from ? new Date(opts.from) : undefined, to: opts.to ? new Date(opts.to) : undefined, limit: opts.limit });
    },
  },
  push: { create: refuse, update: refuse, delete: refuse, act: refuse },
  // The Health view's card, once the Fitness Chamber (which shows its own) is gone.
  feed: () => [{ source: "fitness", views: [{ id: "health", label: "Health", card: true, fullPath: "/health" }], candidates: [{ kind: "view", viewId: "health", score: 15 }] }],
  hooks(ctx) {
    const app = new Hono();
    app.post("/ingest", async (c) => {
      if (!tokenMatches(c.req.header("X-Health-Ingest-Token"))) return c.json({ error: "unauthorized" }, 401);
      const body = healthIngestRequestSchema.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: "invalid_request" }, 400);
      const { samples, skipped } = normalizeHealthAutoExportPayload(body.data);
      const result = ingestSamples(samples);
      const settings = updateHealthSettings({ lastIngestAt: new Date() });
      if (result.changed && settings.publishEvents) ctx.publish("fitness.health_metric_received", { count: result.accepted });
      return c.json({ accepted: result.accepted, duplicated: result.duplicated, skipped });
    });
    return app;
  },
  routes() {
    const app = new Hono();
    app.get("/status", (c) => {
      const s = getHealthSettings();
      return c.json({ hasToken: Boolean(s.ingestToken), lastIngestAt: s.lastIngestAt?.toISOString() ?? null, samples: countMetrics() });
    });
    app.get("/latest", (c) => c.json(latestMetrics()));
    // A new token, shown once: paste it into the Shortcut.
    app.post("/token", (c) => c.json({ token: updateHealthSettings({ ingestToken: randomBytes(24).toString("base64url") }).ingestToken }));
    return app;
  },
  tools(_ctx, server) {
    server.registerTool(
      "health_latest",
      { title: "Latest health metrics", description: "The latest Apple Health value per metric (weight, VO2 max, active and resting energy, last night's sleep in seconds).", inputSchema: {} },
      () => mcpTextResult(latestMetrics())
    );
    server.registerTool(
      "health_list",
      {
        title: "List health metrics",
        description: "Apple Health samples of one metric, newest first.",
        inputSchema: { metricType: healthMetricTypeSchema, since: z.string().optional().describe("ISO time"), limit: z.number().int().min(1).max(500).optional() },
      },
      ({ metricType, since, limit }) => mcpTextResult(listMetrics({ metricType, from: since ? new Date(since) : undefined, limit: limit ?? 100 }))
    );
  },
});
