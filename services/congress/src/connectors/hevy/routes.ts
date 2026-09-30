import { Hono } from "hono";
import { z } from "zod";
import { sql } from "drizzle-orm";
import type { ConnectorContext } from "../contract.js";
import { hevyDb as db } from "./db/client.js";
import { routines, workouts } from "./db/schema.js";
import { getHevySettings, listFolders, updateHevySettings } from "./cache.js";
import { createRoutine, searchExerciseTemplates, updateRoutine } from "./routines.js";
import { createRoutineInputSchema, routineExerciseInputSchema } from "./types.js";

const count = (table: typeof workouts | typeof routines) => Number(db.select({ n: sql<number>`count(*)` }).from(table).get()?.n ?? 0);

function fail(c: { json: (b: unknown, s: 400 | 502) => Response }, err: unknown) {
  return c.json({ error: (err as Error).message }, 502);
}

// The setup panel's API and the routine editor's (Settings → Connectors, /fitness/routines).
export function hevyPanelRoutes(ctx: ConnectorContext): Hono {
  const app = new Hono();

  app.get("/status", (c) => {
    const s = getHevySettings();
    return c.json({ hasKey: Boolean(s.apiKey), lastError: s.lastError, consecutiveFailures: s.consecutiveFailures, workouts: count(workouts), routines: count(routines) });
  });

  app.put("/settings", async (c) => {
    const body = z.object({ apiKey: z.string().trim().min(1).nullable() }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "apiKey must be a string or null" }, 400);
    updateHevySettings({ apiKey: body.data.apiKey, lastError: null, consecutiveFailures: 0 });
    ctx.syncNow();
    return c.json({ hasKey: Boolean(body.data.apiKey) });
  });

  app.get("/folders", (c) => c.json(listFolders()));

  app.get("/templates", async (c) => {
    try {
      return c.json((await searchExerciseTemplates(c.req.query("q") ?? "")).slice(0, 50));
    } catch (err) {
      return fail(c, err);
    }
  });

  // A new routine goes to Hevy once it has a title and an exercise; it becomes a record by its sync.
  app.post("/routines", async (c) => {
    const body = createRoutineInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "A routine needs a title and at least one exercise" }, 400);
    try {
      const rec = await createRoutine(ctx, body.data);
      return c.json({ key: rec.key, recordId: ctx.records.idFor("routine", rec.key) }, 201);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.put("/routines/:key/exercises", async (c) => {
    const body = z.object({ exercises: z.array(routineExerciseInputSchema) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid exercises" }, 400);
    try {
      await updateRoutine(ctx, c.req.param("key"), { exercises: body.data.exercises });
      return c.json({ ok: true });
    } catch (err) {
      return fail(c, err);
    }
  });

  return app;
}
