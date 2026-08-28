import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { updateSettingsRequestSchema } from "./types.js";
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

mountExhibitSearchRoutes(app, { search: searchWorkoutExhibits, resolve: resolveWorkoutExhibits });

mountManualRefsRoutes(
  app,
  { list: listManualRefsByExhibitId, add: addManualRefByExhibitId, remove: removeManualRefByExhibitId },
  resyncWorkoutExhibitByExhibitId
);

mountSettingsRoutes(app, { getSettings, updateSettings }, updateSettingsRequestSchema);

app.route("/mcp", mcpApp);

mountStaticFrontend(app);
