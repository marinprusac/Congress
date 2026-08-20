/// <reference lib="webworker" />
// Hand-written (injectManifest strategy, see vite.config.ts's own comment
// for why) rather than fully generated - Web Push's `push`/`notificationclick`
// listeners below have nowhere to live in a generateSW-produced worker.
// Deliberately excluded from frontend/tsconfig.json (a `webworker` lib
// conflicts with the app's own `DOM` lib in one project) - esbuild still
// transpiles and bundles it at build time, it's just not part of `tsc
// --noEmit`.
import { precacheAndRoute, createHandlerBoundToURL, matchPrecache } from "workbox-precaching";
import { registerRoute, setCatchHandler, NavigationRoute } from "workbox-routing";
import { NetworkOnly, StaleWhileRevalidate } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";

// Baked in at build time (see vite.config.ts's `define`) from the deploy's
// git sha - suffixing the runtime caches below with it means a new deploy
// gets fresh cache names, and the cleanup in `activate` deletes whatever
// the previous deploy's build id left behind. Without this, remote-entry.js
// and the vendor bundle (both deliberately unhashed filenames - see
// vite.remote.config.ts/vite.vendor.config.ts) would stay cached under the
// same cache+key forever, since nothing else about their URL ever changes.
declare const __BUILD_ID__: string;
const CHAMBER_REMOTES_CACHE = `chamber-remotes-${__BUILD_ID__}`;
const VENDOR_CACHE = `vendor-${__BUILD_ID__}`;

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

precacheAndRoute(self.__WB_MANIFEST);

// Same rule generateSW's own navigateFallbackDenylist used to encode via
// config alone - only "/" is a genuine Capitol route; every other
// top-level path ("/notes", "/tasks", ...) is a Chamber proxied through
// server.ts's chamberFrontendProxy, which this worker must never shadow
// with the cached Capitol app shell (curl bypasses the service worker,
// which is why a regression here only ever shows up in a real browser).
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), {
    denylist: [/^\/(?!$)/],
  })
);

// Workbox's router only ever invokes setCatchHandler (below) for a request
// that matched SOME registered route and then failed - a denylisted path
// like /notes/abc matches no route above, so without this the SW's fetch
// listener never touches it at all and an offline failure falls straight
// through to the browser's own native error page. NetworkOnly here matches
// every navigation the route above denylisted, tries the real network
// first (so online behavior - that path reaching server.ts's
// chamberFrontendProxy - is unchanged), and re-throws on failure so
// setCatchHandler gets a chance to serve the cached shell instead.
registerRoute(({ request }) => request.mode === "navigate", new NetworkOnly());

// The shared React/router/query-client bundle every Chamber's remote entry
// resolves via the importmap (see vite.vendor.config.ts) - StaleWhileRevalidate
// so a warm cache serves it instantly while a fresh copy is fetched in the
// background, rather than blocking on network every time.
registerRoute(
  ({ url }) => url.pathname.startsWith("/vendor/") && url.pathname.endsWith(".js"),
  new StaleWhileRevalidate({
    cacheName: VENDOR_CACHE,
    // Without this, an error response (a 502 mid-restart, a stale proxy hit)
    // gets cached as if it were good data - StaleWhileRevalidate has no
    // built-in notion of "this response was bad, don't keep it" otherwise.
    plugins: [new CacheableResponsePlugin({ statuses: [0, 200] }), new ExpirationPlugin({ maxEntries: 20 })],
  })
);

// Every Chamber's own remote-entry.js/.css (its actual UI code and styles,
// not just data) - the same fetches App.tsx's existing preloadChamber/
// ChamberWarmups already make to warm ChamberHost's in-memory module cache
// transparently populate this persistent one too, so a cold tab (new tab,
// reload, returning after a while) serves a Chamber's real interface from
// Cache Storage instead of a fresh network fetch.
registerRoute(
  ({ url }) => /^\/[^/]+\/remote-entry\.(js|css)$/.test(url.pathname),
  new StaleWhileRevalidate({
    cacheName: CHAMBER_REMOTES_CACHE,
    // See the vendor route's own comment above - same reasoning.
    plugins: [new CacheableResponsePlugin({ statuses: [0, 200] }), new ExpirationPlugin({ maxEntries: 64 })],
  })
);

// Handles the failure the NetworkOnly route above re-throws (see its own
// comment for why a route is needed at all) - a full-page load of a
// Chamber-prefixed URL like /notes/abc normally reaches server.ts's
// chamberFrontendProxy, but offline that fetch can't succeed at all.
// Falling back to the precached shell here means it boots anyway and hands
// off to ChamberHost, which resolves that Chamber from the runtime cache
// above - same offline outcome as the shell-hosted navigation this Chamber
// would have gotten if you were already inside the app instead of loading
// it fresh.
setCatchHandler(async ({ request }) => {
  if (request.mode === "navigate") {
    const shell = await matchPrecache("index.html");
    if (shell) return shell;
  }
  return Response.error();
});

self.skipWaiting();
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      const keptCaches = new Set([CHAMBER_REMOTES_CACHE, VENDOR_CACHE]);
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => (name.startsWith("chamber-remotes-") || name.startsWith("vendor-")) && !keptCaches.has(name))
          .map((name) => caches.delete(name))
      );
    })()
  );
});

interface NotificationPushPayload {
  title: string;
  body: string | null;
  chamber: string;
  chamberUrl: string | null;
}

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload: NotificationPushPayload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }
  // Same "chamber + that Chamber's own relative url" shape a notification
  // carries everywhere else (see the notifications Chamber's own
  // pushNotification, notificationPushRequestSchema in shared-types) -
  // resolved into an absolute path here since a notification click always
  // opens a fresh tab/window, never a same-document SPA navigation the way
  // NotificationBell's own click handler can.
  const url = payload.chamberUrl ? `/${payload.chamber}${payload.chamberUrl}` : "/";
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body ?? undefined,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? "/";
  event.waitUntil(
    (async () => {
      const openClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of openClients) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) await (client as WindowClient).navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })()
  );
});
