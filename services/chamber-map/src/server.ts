import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import {
  createPlaceRequestSchema,
  updatePlaceRequestSchema,
  updateSettingsRequestSchema,
  classifyVisitRequestSchema,
  visitStatusSchema,
  labelTripRequestSchema,
  reprocessRequestSchema,
} from "./types.js";
import {
  mountManifestAndHealth,
  mountExhibitSearchRoutes,
  mountSettingsRoutes,
  mountManualRefsRoutes,
  mountStaticFrontend,
} from "@congress/chamber-kit";
import { manifest } from "./manifest.js";
import {
  listPlaces,
  listRecentPlaces,
  searchPlaces,
  getPlace,
  createPlace,
  updatePlace,
  deletePlace,
  listManualRefsByExhibitId,
  addManualRefByExhibitId,
  removeManualRefByExhibitId,
  resyncPlaceExhibitByExhibitId,
} from "./places.js";
import { listVisits, getVisit, getVisitActiveAt, classifyVisit, listTrips, labelTrip } from "./visits.js";
import { getSettings, updateSettings } from "./settings.js";
import { getPollState, toPollHealth } from "./pollState.js";
import { reprocessRange } from "./reprocess.js";
import { searchPlaceExhibits, resolvePlaceExhibits } from "./exhibits.js";
import { mcpApp } from "./mcp/server.js";

export const app = new Hono<{ Bindings: HttpBindings }>();

mountManifestAndHealth(app, manifest);

app.get("/api/places/recent", async (c) => {
  return c.json(await listRecentPlaces());
});

app.get("/api/places/search", async (c) => {
  const query = c.req.query("q") ?? "";
  if (!query.trim()) return c.json([]);
  return c.json(await searchPlaces(query));
});

app.get("/api/places/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const place = await getPlace(id);
  if (!place) return c.json({ error: "not_found" }, 404);
  return c.json(place);
});

app.get("/api/places", async (c) => {
  return c.json(await listPlaces());
});

app.post("/api/places", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createPlaceRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  const place = await createPlace(parsed.data);
  return c.json(place, 201);
});

app.put("/api/places/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const body = await c.req.json().catch(() => null);
  const parsed = updatePlaceRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  const place = await updatePlace(id, parsed.data);
  if (!place) return c.json({ error: "not_found" }, 404);
  return c.json(place);
});

app.delete("/api/places/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const deleted = await deletePlace(id);
  if (!deleted) return c.json({ error: "not_found" }, 404);
  return c.body(null, 204);
});

function parseDateParam(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseLimitParam(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const limit = Number(value);
  return Number.isInteger(limit) && limit > 0 ? limit : undefined;
}

app.get("/api/visits", async (c) => {
  const statusParsed = visitStatusSchema.safeParse(c.req.query("status"));
  const status = statusParsed.success ? statusParsed.data : undefined;
  const from = parseDateParam(c.req.query("from"));
  const to = parseDateParam(c.req.query("to"));
  const limit = parseLimitParam(c.req.query("limit"));
  return c.json(await listVisits({ status, from, to, limit }));
});

// Registered ahead of /api/visits/:id (same reason /api/places/recent and
// /api/places/search sit ahead of /api/places/:id above) - lets the day view
// bookend a day with no visits of its own onto whichever stay was already
// under way when it began.
app.get("/api/visits/active-at", async (c) => {
  const at = parseDateParam(c.req.query("at"));
  if (!at) return c.json({ error: "invalid_request" }, 400);
  const visit = await getVisitActiveAt(at);
  if (!visit) return c.json({ error: "not_found" }, 404);
  return c.json(visit);
});

app.get("/api/visits/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const visit = await getVisit(id);
  if (!visit) return c.json({ error: "not_found" }, 404);
  return c.json(visit);
});

app.post("/api/visits/:id/classify", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const body = await c.req.json().catch(() => null);
  const parsed = classifyVisitRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  const visit = await classifyVisit(id, parsed.data);
  if (!visit) return c.json({ error: "not_found" }, 404);
  return c.json(visit);
});

app.get("/api/trips", async (c) => {
  const from = parseDateParam(c.req.query("from"));
  const to = parseDateParam(c.req.query("to"));
  const limit = parseLimitParam(c.req.query("limit"));
  return c.json(await listTrips({ from, to, limit }));
});

app.post("/api/trips/:id/label", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const body = await c.req.json().catch(() => null);
  const parsed = labelTripRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  const trip = await labelTrip(id, parsed.data);
  if (!trip) return c.json({ error: "not_found" }, 404);
  return c.json(trip);
});

app.get("/api/poll-health", (c) => {
  return c.json(toPollHealth(getPollState()));
});

// Manual history rebuild - the same replay adding a place triggers on its
// own, but pointed wherever the owner wants (after retuning a threshold, or
// after a fix to the classifier itself). Defaults to the whole log.
app.post("/api/reprocess", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = reprocessRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  const from = parsed.data.from ? new Date(parsed.data.from) : new Date(0);
  const to = parsed.data.to ? new Date(parsed.data.to) : new Date();
  if (from.getTime() > to.getTime()) return c.json({ error: "invalid_range" }, 400);
  return c.json(await reprocessRange(from, to));
});

mountExhibitSearchRoutes(app, { search: searchPlaceExhibits, resolve: resolvePlaceExhibits });

mountManualRefsRoutes(
  app,
  { list: listManualRefsByExhibitId, add: addManualRefByExhibitId, remove: removeManualRefByExhibitId },
  resyncPlaceExhibitByExhibitId
);

mountSettingsRoutes(app, { getSettings, updateSettings }, updateSettingsRequestSchema);

app.route("/mcp", mcpApp);

mountStaticFrontend(app);
