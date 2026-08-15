import { Component, Suspense, lazy, useMemo, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchRegistry } from "@congress/exhibit-ui";

// Both caches are keyed by Chamber name and live for the tab's lifetime -
// once a Chamber has been visited once, switching back to it is instant
// (no re-fetch of its JS or CSS), which is the whole point of hosting it in
// this shell instead of a full navigation.
const componentCache = new Map<string, LazyExoticComponent<ComponentType>>();
const stylesheetReady = new Map<string, Promise<void>>();

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

function getChamberComponent(chamberName: string): LazyExoticComponent<ComponentType> {
  let component = componentCache.get(chamberName);
  if (!component) {
    // Waiting on the stylesheet alongside the JS module, both kicked off
    // together, means Suspense only reveals the Chamber once it can render
    // fully styled - the one place a first-ever visit could otherwise flash
    // unstyled content even though there's no document reload.
    component = lazy(() =>
      Promise.all([
        import(/* @vite-ignore */ `/${chamberName}/remote-entry.js`) as Promise<{ default: ComponentType }>,
        loadChamberStylesheet(chamberName),
      ]).then(([mod]) => mod)
    );
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
