import { Component, Suspense, lazy, useMemo, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchRegistry, loadRemoteModule, evictRemoteModule } from "@congress/congress-ui";

// Keyed by Chamber name and lives for the tab's lifetime - once a Chamber
// has been visited once, switching back to it is instant (no re-fetch of
// its JS or CSS), which is the whole point of hosting it in this shell
// instead of a full navigation. The underlying module+stylesheet fetch
// itself is cached in congress-ui's loadRemoteModule (shared with Capitol's
// canvas, which resolves the same remote-entry.js's `widgets` export) -
// this cache is just this file's own lazy()-wrapper layer on top. A Chamber
// is deliberately never fetched before this - no eager warmup of every
// registered Chamber on boot, since that was proactively racing 9 unwanted
// background fetches against whichever one the owner actually opened,
// starving it of connection budget on a slow network. The tradeoff is a
// real loading-bar flash the first time a given Chamber is ever opened in
// this browser (React's lazy() unavoidably suspends on its very first
// render regardless of how fast the fetch resolves) - acceptable since the
// underlying remote-entry.js/.css is then cached by the service worker for
// good (see sw.ts's chamber-remotes route), so every visit after the first
// one, in this session or a future one, renders from cache immediately.
const componentCache = new Map<string, LazyExoticComponent<ComponentType>>();

function getChamberComponent(chamberName: string): LazyExoticComponent<ComponentType> {
  let component = componentCache.get(chamberName);
  if (!component) {
    component = lazy(() => loadRemoteModule(chamberName));
    componentCache.set(chamberName, component);
  }
  return component;
}

function ChamberLoadingBar() {
  return <div className="chamber-host-loading-bar" aria-hidden="true" />;
}

// Congress's own shell never renders a ChamberPicker itself - every route is
// some Chamber's own page, rendering its own (registry-driven) picker. A
// Chamber that fails to load never gets that far, so this is the one
// chamber-route state that needs its own way back.
function ChamberUnavailable({ chamberName, reason }: { chamberName: string; reason: "not-found" | "offline" }) {
  return (
    <div className="chamber-host-unavailable">
      <p>
        {reason === "offline"
          ? `${chamberName} is offline right now.`
          : `No Chamber named "${chamberName}".`}
      </p>
      <Link to="/" className="chamber-host-unavailable-link">
        Back home
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
    // replaying the same rejected import() promise (or the same broken
    // already-fetched component) forever.
    componentCache.delete(this.props.chamberName);
    evictRemoteModule(this.props.chamberName);
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
