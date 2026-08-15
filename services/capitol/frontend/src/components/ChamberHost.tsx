import { Component, Suspense, lazy, useMemo, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchRegistry } from "@congress/exhibit-ui";

// All three caches are keyed by Chamber name and live for the tab's
// lifetime - once a Chamber has been visited once, switching back to it is
// instant (no re-fetch of its JS or CSS), which is the whole point of
// hosting it in this shell instead of a full navigation.
const componentCache = new Map<string, LazyExoticComponent<ComponentType>>();
const stylesheetReady = new Map<string, Promise<void>>();
// The actual module-fetch promise, kept separate from componentCache's
// lazy() wrappers - lazy()'s loader function isn't invoked until React
// first renders that component, so building the wrapper alone can't be used
// to prefetch. Starting (and caching) this promise directly is what lets
// preloadChamber warm the network fetch well before the Chamber is ever
// rendered, so by the time it is, getChamberComponent's lazy() loader just
// resolves an already-settled promise instead of triggering a fresh one.
const modulePromises = new Map<string, Promise<{ default: ComponentType }>>();

function loadChamberStylesheet(chamberName: string): Promise<void> {
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
// never settles at all (see below), not to race a slow-but-healthy one.
const MODULE_LOAD_TIMEOUT_MS = 15_000;

function loadChamberModule(chamberName: string): Promise<{ default: ComponentType }> {
  let modulePromise = modulePromises.get(chamberName);
  if (!modulePromise) {
    // Waiting on the stylesheet alongside the JS module, both kicked off
    // together, means the Chamber is only ever revealed once it can render
    // fully styled - the one place a first-ever visit could otherwise flash
    // unstyled content even though there's no document reload.
    const fetchPromise = Promise.all([
      import(/* @vite-ignore */ `/${chamberName}/remote-entry.js`) as Promise<{ default: ComponentType }>,
      loadChamberStylesheet(chamberName),
    ]).then(([mod]) => mod);

    // A request that lands during a rolling deploy's few-second window (that
    // Chamber's own process, or Capitol's own proxying process, mid-restart)
    // can fail outright, or - if the connection was already open when the
    // old process was killed - hang with no error and no response at all;
    // plain fetch()/import() have no built-in timeout for that second case.
    // Racing a timeout here guarantees this promise always eventually
    // settles instead of leaving a caller (this function's own preload,
    // ChamberHost's lazy import) suspended forever.
    const settled: Promise<{ default: ComponentType }> = new Promise((resolve, reject) => {
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

    // A failed (or timed-out) attempt must not poison the cache for the rest
    // of this tab's lifetime - evict so the next attempt (a preload retry
    // off the registry's periodic refetch, or an actual navigation into this
    // Chamber) starts a fresh fetch instead of replaying the same dead
    // promise forever. Guarded so a late timeout can't evict a newer promise
    // a subsequent retry has already installed.
    modulePromise.catch(() => {
      if (modulePromises.get(chamberName) === modulePromise) {
        modulePromises.delete(chamberName);
      }
    });
  }
  return modulePromise;
}

// Kicks off (or reuses) a Chamber's module+stylesheet fetch without waiting
// on it. Called for every active Chamber as soon as the registry loads (see
// App.tsx), so navigating to any Chamber - from Capitol or from another
// Chamber - never shows ChamberHost's loading bar for a fetch that's already
// well underway or finished.
export function preloadChamber(chamberName: string): void {
  void loadChamberModule(chamberName);
}

function getChamberComponent(chamberName: string): LazyExoticComponent<ComponentType> {
  let component = componentCache.get(chamberName);
  if (!component) {
    component = lazy(() => loadChamberModule(chamberName));
    componentCache.set(chamberName, component);
  }
  return component;
}

function ChamberLoadingBar() {
  return <div className="chamber-host-loading-bar" aria-hidden="true" />;
}

// App.tsx hides Capitol's own ChamberPicker on every chamber-shaped route,
// trusting the hosted Chamber's own (fully equivalent, see App.tsx's
// comment) picker to take over - which never mounts here, so this is the
// one chamber-route state that needs its own way back.
function ChamberUnavailable({ chamberName, reason }: { chamberName: string; reason: "not-found" | "offline" }) {
  return (
    <div className="chamber-host-unavailable">
      <p>
        {reason === "offline"
          ? `${chamberName} is offline right now.`
          : `No Chamber named "${chamberName}".`}
      </p>
      <Link to="/" className="chamber-host-unavailable-link">
        Back to Capitol
      </Link>
    </div>
  );
}

interface ChamberErrorBoundaryProps {
  chamberName: string;
  children: ReactNode;
}
interface ChamberErrorBoundaryState {
  failed: boolean;
}

// A registered "active" Chamber can still fail to actually load (a stale
// heartbeat the sweep hasn't caught yet, a network blip, a genuine bug in
// that Chamber's own code) - without this, a rejected dynamic import or any
// render error thrown by the mounted Chamber propagates uncaught and blanks
// Capitol's entire shell, not just the one Chamber (confirmed by testing).
// Keyed by chamberName at the call site so switching to a *different*
// Chamber always gets a fresh attempt.
class ChamberErrorBoundary extends Component<ChamberErrorBoundaryProps, ChamberErrorBoundaryState> {
  state: ChamberErrorBoundaryState = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    // Evict the failed attempt so a later visit in this same tab - the
    // Chamber redeploying, the network recovering - retries instead of
    // replaying the same rejected import() promise forever.
    componentCache.delete(this.props.chamberName);
    stylesheetReady.delete(this.props.chamberName);
    modulePromises.delete(this.props.chamberName);
  }

  render() {
    if (this.state.failed) {
      return <ChamberUnavailable chamberName={this.props.chamberName} reason="offline" />;
    }
    return this.props.children;
  }
}

// Renders whichever Chamber the URL names directly into this shell's own
// React tree (not an iframe, not a new document) - no BrowserRouter here,
// since the lazy-loaded Chamber component nests into the shell's existing
// one from main.tsx, which is what lets its relative routes ("n/:id", "new",
// ...) resolve correctly against this route's "/:chamber/*" prefix and keeps
// ChamberPicker's active/subnav highlighting in sync across the boundary.
// Only works because the shell and every Chamber's remote entry share one
// React/react-router-dom instance via the importmap in index.html.
export function ChamberHost() {
  const { chamber: chamberName } = useParams<{ chamber: string }>();
  const { data: registry, isLoading } = useQuery({ queryKey: ["congress", "registry"], queryFn: fetchRegistry });

  const entry = registry?.find((c) => c.name === chamberName);
  const ChamberComponent = useMemo(
    () => (chamberName && entry?.status === "active" ? getChamberComponent(chamberName) : null),
    [chamberName, entry?.status]
  );

  if (!chamberName) return null;
  if (isLoading) return <ChamberLoadingBar />;
  if (!entry) return <ChamberUnavailable chamberName={chamberName} reason="not-found" />;
  if (entry.status !== "active" || !ChamberComponent) {
    return <ChamberUnavailable chamberName={chamberName} reason="offline" />;
  }

  return (
    <ChamberErrorBoundary key={chamberName} chamberName={chamberName}>
      <Suspense fallback={<ChamberLoadingBar />}>
        <ChamberComponent />
      </Suspense>
    </ChamberErrorBoundary>
  );
}
