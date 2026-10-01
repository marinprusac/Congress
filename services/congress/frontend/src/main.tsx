import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { openInTab, preventPinchZoom, PersistedQueryProvider, ToastHost, NAV_TABS, type NavTab } from "@congress/congress-ui";
import { queryClient } from "@/lib/queryClient";
import { notifyAppUpdated } from "@/lib/api";
import { App } from "@/App";
import "./index.css";

preventPinchZoom();
// iOS only applies :active (press feedback, motion.css) with a touch listener.
document.addEventListener("touchstart", () => {}, { passive: true });

// sw.ts calls skipWaiting()+clients.claim() unconditionally, so a new
// deploy's service worker takes over as soon as the browser's own
// background update check finds it - but claiming control doesn't touch
// JS this page already loaded and ran. Without a reload here, an installed
// PWA that's relaunched (not freshly network-navigated - see the SW's own
// NavigationRoute, which serves "/" from precache) can keep rendering an
// old cached bundle indefinitely across deploys, even across a full
// force-quit/reopen, since each relaunch races the update check rather
// than waiting on it. `registerSW.js`'s injected registration is the bare
// vite-plugin-pwa default with no reload-on-update logic of its own.
//
// Also logs a congress.app_updated event for this - a Logs Chamber rule can
// turn "the app updated" into a push notification/history entry. Awaited
// before reloading rather than fired-and-forgotten - see notifyAppUpdated's
// own comment on why `keepalive` alone isn't trustworthy enough here.
if ("serviceWorker" in navigator) {
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    void notifyAppUpdated().finally(() => window.location.reload());
  });

  // registerSW.js only ever checks for an update once, at initial
  // registration - an installed PWA that's backgrounded and resumed
  // (rather than freshly navigated) never triggers another check on its
  // own, so the controllerchange chain above can go a long time without
  // firing even across several real deploys. `.update()` on every
  // foreground closes that gap.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    void navigator.serviceWorker.getRegistration().then((reg) => reg?.update());
  });

  // A notification tapped while the app is open (sw.ts's notificationclick).
  navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as { type?: unknown; url?: unknown; tab?: unknown } | null;
    if (data?.type !== "congress:open" || typeof data.url !== "string" || !data.url.startsWith("/")) return;
    const tab = NAV_TABS.includes(data.tab as NavTab) ? (data.tab as NavTab) : "notifications";
    openInTab(data.url, tab);
  });
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <PersistedQueryProvider client={queryClient} namespace="congress">
      <BrowserRouter>
        <App />
      </BrowserRouter>
      <ToastHost />
    </PersistedQueryProvider>
  </StrictMode>
);
