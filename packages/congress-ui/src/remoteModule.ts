import type { ComponentType } from "react";

// What a Chamber's frontend/src/remote.tsx is expected to export: `default`
// is the whole app (what ChamberHost mounts for full-page navigation),
// `widgets` is the id -> component map Capitol's canvas resolves widgets
// out of (a Chamber with no widgets, or Congress's own shell, just omits
// it), and `settings` is that Chamber's own settings panel content -
// resolved the same way, out of the same already-fetched module - and
// mounted as one tab of Congress's own unified Settings page instead of a
// route the Chamber hosts itself (a Chamber with nothing configurable omits
// it, same as widgets). One shared shape so every consumer agrees on what's
// in the module namespace object import() resolves to.
export interface RemoteModule {
  default: ComponentType;
  widgets?: Record<string, ComponentType>;
  settings?: ComponentType;
}

// Shared by ChamberHost (full-Chamber navigation) and Capitol's canvas
// (individual widgets) - both dynamically import the *same*
// /${chamberName}/remote-entry.js per Chamber, so fetching and caching it
// once here means visiting a Chamber's full page also warms its widgets and
// vice versa, instead of each consumer keeping its own separate cache of
// the same file.
const stylesheetReady = new Map<string, Promise<void>>();
const modulePromises = new Map<string, Promise<RemoteModule>>();

function loadRemoteStylesheet(chamberName: string): Promise<void> {
  const href = `/${chamberName}/remote-entry.css`;
  let ready = stylesheetReady.get(chamberName);
  if (!ready) {
    ready = new Promise((resolve) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      // A failed stylesheet load shouldn't block the Chamber from mounting
      // (better an unstyled Chamber than a permanently stuck loading bar).
      link.onload = () => resolve();
      link.onerror = () => resolve();
      document.head.appendChild(link);
    });
    stylesheetReady.set(chamberName, ready);
  }
  return ready;
}

// Generous above any real network RTT - only meant to catch a request that
// never settles at all (a rolling-deploy restart window can leave a
// connection open with no response), not to race a slow-but-healthy one.
const MODULE_LOAD_TIMEOUT_MS = 15_000;

// Fetches (and caches) a Chamber's remote entry module + stylesheet
// together, so a caller is only ever handed a module once it can render
// fully styled. Safe to call repeatedly for the same chamberName - later
// calls reuse the in-flight or settled promise.
export function loadRemoteModule(chamberName: string): Promise<RemoteModule> {
  let modulePromise = modulePromises.get(chamberName);
  if (!modulePromise) {
    const fetchPromise = Promise.all([
      import(/* @vite-ignore */ `/${chamberName}/remote-entry.js`) as Promise<RemoteModule>,
      loadRemoteStylesheet(chamberName),
    ]).then(([mod]) => mod);

    // plain fetch()/import() have no built-in timeout for a hung connection
    // (the second failure mode above) - racing a timeout here guarantees
    // this promise always eventually settles instead of leaving a caller
    // (React's lazy(), an explicit preload) suspended forever.
    const settled: Promise<RemoteModule> = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Loading Chamber "${chamberName}" timed out`)),
        MODULE_LOAD_TIMEOUT_MS
      );
      fetchPromise.then(
        (mod) => {
          clearTimeout(timer);
          resolve(mod);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });

    modulePromise = settled;
    modulePromises.set(chamberName, modulePromise);

    // A failed (or timed-out) attempt must not poison the cache for the
    // rest of this tab's lifetime - evict so the next attempt (a preload
    // retry, an actual navigation/widget mount) starts a fresh fetch
    // instead of replaying the same dead promise forever. Guarded so a late
    // timeout can't evict a newer promise a subsequent retry already
    // installed.
    modulePromise.catch(() => {
      if (modulePromises.get(chamberName) === modulePromise) {
        modulePromises.delete(chamberName);
      }
    });
  }
  return modulePromise;
}

// For a caller whose error boundary caught a failure *after* a successful
// fetch (a genuine bug in the Chamber's own rendered code, not a load
// failure) - the fetch promise itself resolved fine and won't self-evict,
// so the next attempt needs this called explicitly to avoid replaying a
// component that's already known to be broken.
export function evictRemoteModule(chamberName: string): void {
  modulePromises.delete(chamberName);
  stylesheetReady.delete(chamberName);
}
