import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono, Context } from "hono";
import type { HttpBindings } from "@hono/node-server";
import {
  exhibitResolveRequestSchema,
  updateSharedExhibitContentRequestSchema,
  type ExhibitSearchResult,
  type ExhibitResolveResult,
  type SharedExhibitContent,
  type UpdateSharedExhibitContentRequest,
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
}

export interface ExhibitContentApi {
  getContent: (id: string) => Promise<SharedExhibitContent | null>;
  updateContent: (id: string, input: UpdateSharedExhibitContentRequest) => Promise<SharedExhibitContent | null>;
}

export interface ExhibitContentRoutesOptions {
  // Lets a Chamber turn its own domain error (e.g. a title conflict) into a
  // specific response instead of a generic 500 - return undefined to fall
  // through to rethrowing.
  onUpdateError?: (c: Context, err: unknown) => Response | undefined;
}

// Backing the token-scoped Exhibit Sharing proxy at Capitol - unauthenticated
// here, same trust model as the search/resolve routes above, since Capitol
// has already validated the share token + closure membership before ever
// proxying a request through to this route.
export function mountExhibitContentRoutes(
  app: ChamberApp,
  exhibits: ExhibitContentApi,
  opts: ExhibitContentRoutesOptions = {}
): void {
  app.get("/api/exhibits/:id/content", async (c) => {
    const content = await exhibits.getContent(c.req.param("id"));
    if (!content) return c.json({ error: "not_found" }, 404);
    return c.json(content);
  });

  app.patch("/api/exhibits/:id/content", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = updateSharedExhibitContentRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
    }
    try {
      const content = await exhibits.updateContent(c.req.param("id"), parsed.data);
      if (!content) return c.json({ error: "not_found" }, 404);
      return c.json(content);
    } catch (err) {
      const handled = opts.onUpdateError?.(c, err);
      if (handled) return handled;
      throw err;
    }
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

export function mountStaticFrontend(app: ChamberApp): void {
  app.use(
    "/*",
    serveStatic({
      root: "./frontend/dist",
    })
  );
  app.get("*", serveStatic({ path: "./frontend/dist/index.html" }));
}
