import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import {
  exhibitResolveRequestSchema,
  manualRefRequestSchema,
  type ExhibitSearchResult,
  type ExhibitResolveResult,
  type Manifest,
} from "@congress/shared-types";

type ChamberApp = Hono<{ Bindings: HttpBindings }>;

export function mountManifestAndHealth(app: ChamberApp, manifest: Manifest): void {
  app.get("/manifest", (c) => c.json(manifest));
  app.get("/health", (c) => c.json({ status: "ok" }));
}

export interface ExhibitSearchApi {
  search: (query: string, limit?: number) => Promise<ExhibitSearchResult[]>;
  resolve: (ids: string[]) => Promise<ExhibitResolveResult[]>;
  // Turns this Chamber's own raw row id into a chip-ready Exhibit id +
  // name/url - optional since only table-backed Chambers (createTableBackedExhibits)
  // support it today; a hand-rolled ExhibitSearchApi (e.g. calendar's compound
  // ids) can omit it and the route below answers "not_supported" instead.
  chip?: (rawId: number) => Promise<{ id: string; name: string; url: string } | { id: string; deleted: true }>;
}

// The cross-Chamber "[[" picker and Capitol's global search both hit these -
// an empty query is expected to return the most-recently-updated items
// rather than nothing, which is each Chamber's own search()'s job to honor.
export function mountExhibitSearchRoutes(app: ChamberApp, exhibits: ExhibitSearchApi): void {
  app.get("/api/exhibits/search", async (c) => {
    const query = c.req.query("q") ?? "";
    const limit = Number(c.req.query("limit")) || undefined;
    return c.json({ results: await exhibits.search(query, limit) });
  });

  app.post("/api/exhibits/resolve", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = exhibitResolveRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
    }
    return c.json({ results: await exhibits.resolve(parsed.data.ids) });
  });

  app.get("/api/exhibits/chip/:rawId", async (c) => {
    if (!exhibits.chip) return c.json({ error: "not_supported" }, 404);
    const rawId = Number(c.req.param("rawId"));
    if (!Number.isInteger(rawId)) return c.json({ error: "invalid_id" }, 400);
    const result = await exhibits.chip(rawId);
    if ("deleted" in result) return c.json({ error: "not_found" }, 404);
    return c.json(result);
  });
}

export interface SettingsApi<TSettings> {
  getSettings: () => Promise<TSettings>;
  updateSettings: (input: Partial<TSettings>) => Promise<TSettings>;
}

export function mountSettingsRoutes<TSettings>(
  app: ChamberApp,
  settingsApi: SettingsApi<TSettings>,
  updateSchema: { safeParse: (input: unknown) => { success: boolean; data?: Partial<TSettings>; error?: any } }
): void {
  app.get("/api/settings", async (c) => {
    return c.json(await settingsApi.getSettings());
  });

  app.put("/api/settings", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
    }
    return c.json(await settingsApi.updateSettings(parsed.data as Partial<TSettings>));
  });
}

export interface ManualRefsApi {
  // All three take the full Exhibit id (e.g. "note-3"), not a bare row id -
  // same convention as ExhibitContentApi above, and for the same reason:
  // this is mounted at a fixed path with no Chamber-specific prefix, and
  // Capitol proxies to it generically (see POST/DELETE
  // "/congress/exhibits/:id/connections" in services/congress/src/server.ts) without
  // knowing any Chamber's internal id scheme. Return null/false for an id
  // this Chamber doesn't own or can't parse.
  list: (exhibitId: string) => string[] | null;
  add: (exhibitId: string, targetExhibitId: string) => boolean;
  remove: (exhibitId: string, targetExhibitId: string) => boolean;
}

// Explicit references added from a side panel instead of embedded "[[" text
// (see docs/congress-project-brief.md's Exhibits section) - mounted at
// "/api/exhibits/:id/refs". `onChange` is the owning Chamber's hook for
// recomputing its outgoingRefs and pushing an updated sync to Capitol, since
// a manual add/remove changes that set exactly like an edit to body text
// would.
export function mountManualRefsRoutes(
  app: ChamberApp,
  refs: ManualRefsApi,
  onChange: (exhibitId: string) => Promise<void>
): void {
  app.get("/api/exhibits/:id/refs", (c) => {
    const list = refs.list(c.req.param("id"));
    if (list === null) return c.json({ error: "not_found" }, 404);
    return c.json({ refs: list });
  });

  app.post("/api/exhibits/:id/refs", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const parsed = manualRefRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
    }
    if (!refs.add(id, parsed.data.targetExhibitId)) return c.json({ error: "not_found" }, 404);
    await onChange(id);
    return c.json({ refs: refs.list(id) });
  });

  app.delete("/api/exhibits/:id/refs/:targetExhibitId", async (c) => {
    const id = c.req.param("id");
    if (!refs.remove(id, c.req.param("targetExhibitId"))) return c.json({ error: "not_found" }, 404);
    await onChange(id);
    return c.json({ refs: refs.list(id) });
  });
}

export function mountStaticFrontend(app: ChamberApp): void {
  app.use(
    "/*",
    serveStatic({
      root: "./frontend/dist",
    })
  );
  // Falls through to frontend/public directly (Hono's serveStatic calls
  // next() on a miss) so assets that live there unchanged by the build -
  // notably icons/mark.svg, fetched by Capitol's gateway at runtime, see
  // proxyToChamberIcon - resolve even before `build:web` has ever run.
  // frontend/dist always wins once it exists: Vite's build copies public/
  // into dist/ verbatim, so this mount is dev-only in practice.
  app.use(
    "/*",
    serveStatic({
      root: "./frontend/public",
    })
  );
  // Only a navigation-shaped miss (no file extension on the last path
  // segment - "/settings", "/notes/n42", ...) falls back to the SPA shell.
  // Anything that looks like a static asset request (remote-entry.js,
  // vendor/react-query.js, a mistyped asset URL, ...) 404s instead of
  // silently getting index.html's markup back with a 200 - without this, a
  // build step that never ran (e.g. a skipped `build:vendor`) failed
  // completely silently: the browser got a 200 for a `.js` URL whose body
  // was actually index.html, which fails ES module parsing with no console
  // error and no failing network request pointing at the real cause.
  app.get("*", (c, next) => {
    const lastSegment = c.req.path.slice(c.req.path.lastIndexOf("/") + 1);
    if (lastSegment.includes(".")) return next();
    return serveStatic({ path: "./frontend/dist/index.html" })(c, next);
  });
}
