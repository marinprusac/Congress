import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { markShellHosted, preventPinchZoom, PersistedQueryProvider, ToastHost } from "@congress/congress-ui";
import { queryClient } from "@/lib/queryClient";
import { notifyAppUpdated } from "@/lib/api";
import { App } from "@/App";
import "./index.css";

// Capitol always acts as the shell (see ChamberHost) - this is what tells
// ChamberPicker/ChamberHeader it's safe to use <Link> for cross-app jumps
// here, not just for Capitol's own internal routes. Must run before the
// first render, and before any Chamber's remote entry could possibly mount.
markShellHosted();
preventPinchZoom();

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
// turn "the app updated" into a push notification/history entry the same
// way any other Chamber's own event does, and this is the one place in the
// system that actually observes a new version taking over. Awaited before
// reloading (notifyAppUpdated's own timeout bounds the wait) rather than
// fired-and-forgotten alongside the reload - see its comment on why
// `keepalive` alone isn't trustworthy enough here to fire-and-forget.
if ("serviceWorker" in navigator) {
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    void notifyAppUpdated().finally(() => window.location.reload());
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
