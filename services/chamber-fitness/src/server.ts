import { Hono, type Context } from "hono";
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
import { search as searchExhibits, resolve as resolveExhibits } from "./exhibits.js";
import {
  RoutinesError,
  listRoutines,
  getRoutine,
  createRoutine,
  updateRoutine,
  listRoutineFolders,
  searchExerciseTemplates,
} from "./routines.js";
import { createRoutineRequestSchema, updateRoutineRequestSchema } from "./types.js";
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

// RoutinesError.code surfaces distinct, named failure modes (no Hevy key
// configured; Hevy accepted a create but didn't echo the created routine
// back) rather than a generic 500 - the frontend renders these as specific,
// actionable messages instead of an invitation to blindly retry. Anything
// else rethrows, same as every other route in this file with no try/catch
// of its own (Hono's own error handling turns an uncaught throw into a 500).
function asRoutinesErrorResponse(c: Context, err: unknown) {
  if (!(err instanceof RoutinesError)) throw err;
  const status = err.code === "hevy_not_configured" ? 400 : 502;
  return c.json({ error: err.code, message: err.message }, status);
}

app.get("/api/routines", async (c) => {
  try {
    return c.json(await listRoutines());
  } catch (err) {
    return asRoutinesErrorResponse(c, err);
  }
});

app.get("/api/routines/:id", async (c) => {
  try {
    const routine = await getRoutine(c.req.param("id"));
    if (!routine) return c.json({ error: "not_found" }, 404);
    return c.json(routine);
  } catch (err) {
    return asRoutinesErrorResponse(c, err);
  }
});

app.post("/api/routines", async (c) => {
  const parsed = createRoutineRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  try {
    return c.json(await createRoutine(parsed.data), 201);
  } catch (err) {
    return asRoutinesErrorResponse(c, err);
  }
});

app.put("/api/routines/:id", async (c) => {
  const parsed = updateRoutineRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  try {
    const routine = await updateRoutine(c.req.param("id"), parsed.data);
    if (!routine) return c.json({ error: "not_found" }, 404);
    return c.json(routine);
  } catch (err) {
    return asRoutinesErrorResponse(c, err);
  }
});

app.get("/api/routine-folders", async (c) => {
  try {
    return c.json(await listRoutineFolders());
  } catch (err) {
    return asRoutinesErrorResponse(c, err);
  }
});

app.get("/api/exercise-templates", async (c) => {
  try {
    return c.json(await searchExerciseTemplates(c.req.query("q") ?? ""));
  } catch (err) {
    return asRoutinesErrorResponse(c, err);
  }
});

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

mountExhibitSearchRoutes(app, { search: searchExhibits, resolve: resolveExhibits });

mountManualRefsRoutes(
  app,
  { list: listManualRefsByExhibitId, add: addManualRefByExhibitId, remove: removeManualRefByExhibitId },
  resyncWorkoutExhibitByExhibitId
);

mountSettingsRoutes(app, { getSettings, updateSettings }, updateSettingsRequestSchema);

app.route("/mcp", mcpApp);

mountStaticFrontend(app);
