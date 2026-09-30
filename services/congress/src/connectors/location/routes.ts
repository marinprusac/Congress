import { Hono } from "hono";
import { z } from "zod";
import { classifyVisit, getVisit, getVisitActiveAt, listTrips, listVisits } from "./visits.js";
import { listPlaces } from "./places.js";
import { getPollState, toPollHealth } from "./pollState.js";
import { reprocessRange } from "./reprocess.js";
import { getSettings, traccarConfig, updateSettings, writeRow } from "./settings.js";
import { classifyVisitRequestSchema, reprocessRequestSchema, updateSettingsRequestSchema, visitStatusSchema } from "./types.js";

const date = (v: string | undefined) => {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};
const limit = (v: string | undefined) => (v && Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : undefined);

const traccarInput = z.object({ url: z.string().url(), token: z.string().min(1), deviceId: z.number().int().positive() });

// The Map views' and setup panel's API (/congress/connectors/location/*).
export function locationRoutes(): Hono {
  const app = new Hono();

  app.get("/places", async (c) => c.json(await listPlaces()));

  app.get("/visits", async (c) => {
    const status = visitStatusSchema.safeParse(c.req.query("status"));
    return c.json(await listVisits({ status: status.success ? status.data : undefined, from: date(c.req.query("from")), to: date(c.req.query("to")), limit: limit(c.req.query("limit")) }));
  });

  app.get("/visits/active-at", async (c) => {
    const at = date(c.req.query("at"));
    if (!at) return c.json({ error: "invalid_request" }, 400);
    return c.json(await getVisitActiveAt(at));
  });

  app.get("/visits/:id", async (c) => {
    const visit = await getVisit(Number(c.req.param("id")));
    return visit ? c.json(visit) : c.json({ error: "not_found" }, 404);
  });

  // A visit a rebuild already replaced (e.g. after its new Place was made) is simply done.
  app.post("/visits/:id/classify", async (c) => {
    const id = Number(c.req.param("id"));
    const body = classifyVisitRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!Number.isInteger(id) || !body.success) return c.json({ error: "invalid_request" }, 400);
    const visit = await classifyVisit(id, body.data);
    return c.json(visit ?? { gone: true });
  });

  app.get("/trips", async (c) => c.json(await listTrips({ from: date(c.req.query("from")), to: date(c.req.query("to")), limit: limit(c.req.query("limit")) })));

  app.get("/status", async (c) => {
    const config = traccarConfig();
    return c.json({
      traccar: config ? { url: config.url, deviceId: config.deviceId } : null,
      poll: toPollHealth(getPollState()),
      settings: await getSettings(),
    });
  });

  app.put("/settings", async (c) => {
    const body = updateSettingsRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request" }, 400);
    return c.json(await updateSettings(body.data));
  });

  // The token is write-only: it never comes back out.
  app.put("/traccar", async (c) => {
    const body = traccarInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "A Traccar URL, token and device id are needed" }, 400);
    writeRow({ traccarUrl: body.data.url.replace(/\/$/, ""), traccarToken: body.data.token, traccarDeviceId: body.data.deviceId });
    return c.json({ ok: true });
  });

  app.post("/reprocess", async (c) => {
    const body = reprocessRequestSchema.safeParse((await c.req.json().catch(() => ({}))) ?? {});
    if (!body.success) return c.json({ error: "invalid_request" }, 400);
    const from = body.data.from ? new Date(body.data.from) : new Date(0);
    const to = body.data.to ? new Date(body.data.to) : new Date();
    if (from > to) return c.json({ error: "invalid_range" }, 400);
    return c.json(await reprocessRange(from, to));
  });

  return app;
}
