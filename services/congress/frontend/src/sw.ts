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
import { NetworkOnly } from "workbox-strategies";

// Baked in at build time (see vite.config.ts's `define`) from the deploy's git sha.
declare const __BUILD_ID__: string;
void __BUILD_ID__;

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

precacheAndRoute(self.__WB_MANIFEST);

// Only Congress's own shell routes are served from the cached app shell;
// every other top-level path is a server route (or a retired Chamber's old
// URL the server answers with the shell), which this worker must never
// shadow (curl bypasses the service worker, which is why a regression here
// only ever shows up in a real browser). Keep this in step with App.tsx.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), {
    denylist: [/^\/(?!$|search$|notifications$|settings$|chat$|chat\/|view\/|e\/|events$|events\/|fitness\/|map$|map\/|whatsapp$|whatsapp\/)/],
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

// Offline, a denylisted navigation has no network to reach: serve the cached
// shell instead of the browser's error page.
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
      // The retired Chamber-bundle and vendor runtime caches.
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.filter((name) => name.startsWith("chamber-remotes-") || name.startsWith("vendor-")).map((name) => caches.delete(name)));
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
  // the Notifications page can. Congress's own events are already
  // root-relative.
  const url = !payload.chamberUrl ? "/" : payload.chamber === "congress" ? payload.chamberUrl : `/${payload.chamber}${payload.chamberUrl}`;
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
          // The open app pushes it onto its Notifications tab in-document
          // (main.tsx) instead of reloading onto it.
          client.postMessage({ type: "congress:open", url, tab: "notifications" });
          return;
        }
      }
      // A fresh window: the page's cold start reads the tab from the URL
      // (navStack.ts's NAV_TAB_PARAM) and strips it.
      const [path, hash = ""] = url.split("#");
      await self.clients.openWindow(`${path}${path!.includes("?") ? "&" : "?"}navtab=notifications${hash ? `#${hash}` : ""}`);
    })()
  );
});
