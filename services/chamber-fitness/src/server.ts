import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { updateSettingsRequestSchema, healthIngestRequestSchema } from "./types.js";
import type { HealthMetricType } from "./types.js";
import {
  mountManifestAndHealth,
  mountExhibitSearchRoutes,
  mountSettingsRoutes,
  mountManualRefsRoutes,
  mountStaticFrontend,
} from "@congress/chamber-kit";
import { manifest } from "./manifest.js";
import { listWorkouts, listRecentWorkouts, getWorkout, getWeekStats, resyncWorkoutExhibitByExhibitId } from "./workouts.js";
import { listManualRefsByExhibitId, addManualRefByExhibitId, removeManualRefByExhibitId } from "./refs.js";
import { getSettings, updateSettings } from "./settings.js";
import { searchWorkoutExhibits, resolveWorkoutExhibits } from "./exhibits.js";
import { getSyncState, toSyncHealth } from "./hevy/pollState.js";
import { syncNow } from "./hevy/poller.js";
import { isValidIngestToken, ingestSamples } from "./health/ingest.js";
import { normalizeHealthAutoExportPayload } from "./health/normalize.js";
import { listHealthMetrics, getLatestHealthMetrics } from "./healthMetrics.js";
import { mcpApp } from "./mcp/server.js";

export const app = new Hono<{ Bindings: HttpBindings }>();

mountManifestAndHealth(app, manifest);

app.get("/api/workouts/recent", async (c) => {
  return c.json(await listRecentWorkouts());
});

app.get("/api/workouts/week-stats", async (c) => {
  return c.json(await getWeekStats());
});

app.get("/api/workouts/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const workout = await getWorkout(id);
  if (!workout) return c.json({ error: "not_found" }, 404);
  return c.json(workout);
});

app.get("/api/workouts", async (c) => {
  const limit = Number(c.req.query("limit")) || undefined;
  return c.json(await listWorkouts(limit));
});

// Workouts are read-only from this Chamber's own API - Hevy is the sole
// source of truth for their content, so there is deliberately no
// create/update/delete route here (unlike the scaffold's generic "item").

app.get("/api/sync-health", async (c) => {
  return c.json(toSyncHealth(getSyncState()));
});

app.post("/api/sync", async (c) => {
  await syncNow();
  return c.json(toSyncHealth(getSyncState()));
});

// Pushed to by an iOS Shortcut (relaying a Health Auto Export "export"
// action's own JSON output), not read by the browser - the only route in
// this Chamber that authenticates itself rather than relying on Congress's
// session gate, because a Shortcut can present neither a session cookie nor
// the shared internal token. See health/ingest.ts and health/normalize.ts.
app.post("/api/health/ingest", async (c) => {
  if (!(await isValidIngestToken(c.req.header("X-Health-Ingest-Token")))) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const parsed = healthIngestRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  const { samples, skipped } = normalizeHealthAutoExportPayload(parsed.data);
  const result = await ingestSamples(samples);
  return c.json({ accepted: result.accepted, duplicated: result.duplicated, skipped });
});

app.get("/api/health/metrics", async (c) => {
  const metricType = (c.req.query("type") as HealthMetricType | undefined) ?? undefined;
  const since = c.req.query("since");
  const limit = Number(c.req.query("limit")) || undefined;
  return c.json(await listHealthMetrics({ metricType, since: since ? new Date(since) : undefined, limit }));
});

app.get("/api/health/latest", async (c) => {
  return c.json(await getLatestHealthMetrics());
});

mountExhibitSearchRoutes(app, { search: searchWorkoutExhibits, resolve: resolveWorkoutExhibits });

mountManualRefsRoutes(
  app,
  { list: listManualRefsByExhibitId, add: addManualRefByExhibitId, remove: removeManualRefByExhibitId },
  resyncWorkoutExhibitByExhibitId
);

mountSettingsRoutes(app, { getSettings, updateSettings }, updateSettingsRequestSchema);

app.route("/mcp", mcpApp);

mountStaticFrontend(app);
