import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import type { Manifest } from "@congress/shared-types";

type App = Hono<{ Bindings: HttpBindings }>;

export function mountManifestAndHealth(app: App, manifest: Manifest): void {
  app.get("/manifest", (c) => c.json(manifest));
  app.get("/health", (c) => c.json({ status: "ok" }));
}

// Recognized static-asset extensions for the SPA-fallback check below -
// deliberately a fixed allowlist, not "has a dot", since a route param
// (an event type, a version string, ...) can legitimately contain one too.
const STATIC_ASSET_EXTENSION =
  /\.(js|mjs|css|map|json|html|ico|png|jpe?g|gif|svg|webp|avif|woff2?|ttf|eot|otf|wasm|txt|xml|webmanifest|br|gz|pdf)$/i;

export function cacheControlFor(path: string): string | undefined {
  if (path.includes("/assets/")) {
    return "public, max-age=31536000, immutable";
  }
  const lastSegment = path.slice(path.lastIndexOf("/") + 1);
  if (lastSegment === "index.html" || lastSegment === "remote-entry.js" || lastSegment === "remote-entry.css") {
    return "public, max-age=60, must-revalidate";
  }
  return undefined;
}

export function mountStaticFrontend(app: App): void {
  // Registered ahead of the serveStatic mounts below so the header lands on
  // the same underlying Headers instance they (and the SPA-fallback route
  // further down) build the eventual Response from - setting Cache-Control
  // any later, e.g. from serveStatic's own onFound hook, is too late: by
  // then the Response has already been constructed and copied its headers.
  app.use("/*", async (c, next) => {
    const cacheControl = cacheControlFor(c.req.path);
    if (cacheControl) c.header("Cache-Control", cacheControl);
    await next();
  });
  app.use(
    "/*",
    serveStatic({
      root: "./frontend/dist",
      // Streams a pre-built .br/.gz sibling when one exists and the
      // request's Accept-Encoding allows it (see scripts/compress-dist.mjs,
      // run once per deploy) instead of every hop - Caddy included -
      // recompressing the same file from scratch on every single request.
      // A no-op locally / for any file the compress step hasn't touched:
      // serveStatic just falls back to the plain file when no sibling
      // exists.
      precompressed: true,
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
  // Only a request that actually looks like a static asset (a recognized
  // file extension on the last path segment - remote-entry.js,
  // vendor/react-query.js, a mistyped asset URL, ...) 404s instead of
  // silently getting index.html's markup back with a 200 - without this, a
  // build step that never ran (e.g. a skipped `build:vendor`) failed
  // completely silently: the browser got a 200 for a `.js` URL whose body
  // was actually index.html, which fails ES module parsing with no console
  // error and no failing network request pointing at the real cause.
  // Deliberately an extension allowlist rather than "last segment contains
  // a dot" - a route param can legitimately contain one (chamber-logs'
  // /events/:eventType, e.g. "tasks.due_soon", used to 404 on reload
  // because of exactly that).
  app.get("*", (c, next) => {
    const lastSegment = c.req.path.slice(c.req.path.lastIndexOf("/") + 1);
    if (STATIC_ASSET_EXTENSION.test(lastSegment)) return next();
    return serveStatic({ path: "./frontend/dist/index.html" })(c, next);
  });
}
