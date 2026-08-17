/// <reference lib="webworker" />
// Hand-written (injectManifest strategy, see vite.config.ts's own comment
// for why) rather than fully generated - Web Push's `push`/`notificationclick`
// listeners below have nowhere to live in a generateSW-produced worker.
// Deliberately excluded from frontend/tsconfig.json (a `webworker` lib
// conflicts with the app's own `DOM` lib in one project) - esbuild still
// transpiles and bundles it at build time, it's just not part of `tsc
// --noEmit`.
import { precacheAndRoute, createHandlerBoundToURL } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";

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

self.skipWaiting();
self.addEventListener("activate", () => self.clients.claim());

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
