import { Component, Suspense, lazy, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChamberMark, loadRemoteModule, evictRemoteModule, resolveChamberPath } from "@congress/congress-ui";
import type { ChamberRegistryEntry, ManifestView } from "@congress/shared-types";

// Keyed by "<chamber>:<viewId>", one lazy() wrapper per view card - a render
// failure takes down only that one card, not every card from the same
// Chamber. The underlying module+stylesheet fetch is still shared (and
// cached once) via congress-ui's loadRemoteModule.
const cache = new Map<string, LazyExoticComponent<ComponentType>>();

function getViewComponent(chamber: string, viewId: string): LazyExoticComponent<ComponentType> {
  const key = `${chamber}:${viewId}`;
  let component = cache.get(key);
  if (!component) {
    component = lazy(async () => {
      const mod = await loadRemoteModule(chamber);
      const View = mod.views?.[viewId];
      if (!View) throw new Error(`Chamber "${chamber}" has no view "${viewId}"`);
      return { default: View };
    });
    cache.set(key, component);
  }
  return component;
}

// Evicts both this card's lazy() wrapper and the whole Chamber's module
// fetch - a broken card may be a symptom of a stale remote-entry.js.
function evictViewComponent(chamber: string, viewId: string): void {
  cache.delete(`${chamber}:${viewId}`);
  evictRemoteModule(chamber);
}

class ViewErrorBoundary extends Component<{ chamber: string; viewId: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    evictViewComponent(this.props.chamber, this.props.viewId);
  }

  render() {
    if (this.state.failed) return <p className="font-mono text-xs text-alert">This view failed to load.</p>;
    return this.props.children;
  }
}

function ViewLoading() {
  return <div className="h-full w-full animate-pulse bg-ink/[0.04]" aria-hidden="true" />;
}

// An offline Chamber's card stays visibly present rather than silently
// vanishing - the same diagonal hatch the old canvas used.
function OfflineHatch({ label }: { label: string }) {
  return (
    <>
      <span className="sr-only">{label} is unavailable</span>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "repeating-linear-gradient(135deg, transparent, transparent 7px, color-mix(in srgb, var(--color-ink) 12%, transparent) 7px, color-mix(in srgb, var(--color-ink) 12%, transparent) 8px)",
        }}
      />
    </>
  );
}

export function viewHref(chamber: string, view: Pick<ManifestView, "id" | "fullPath">): string {
  return view.fullPath ? resolveChamberPath(view.fullPath, chamber, true) : `/view/${chamber}/${view.id}`;
}

// Congress's frame around one Chamber view: the Chamber's mark, the view's
// label, why it's in the feed right now, and a way into the full view. A
// view with a card (manifest `card: true`) shows the Chamber's own card
// component as its body; one without is just a row that opens it.
export function ViewSlot({
  chamber,
  view,
  reason,
  full = false,
}: {
  chamber: ChamberRegistryEntry;
  view: ManifestView;
  reason?: string;
  // The card is the whole page (/view/:chamber/:viewId), not a feed item.
  full?: boolean;
}) {
  const active = chamber.status === "active";

  if (!view.card) {
    return (
      <section className="feed-card">
        <Link to={viewHref(chamber.name, view)} className="feed-exhibit">
          <ChamberMark name={chamber.name} />
          <span className="feed-exhibit-name">{view.label}</span>
          {reason && <span className="feed-card-reason">{reason}</span>}
        </Link>
      </section>
    );
  }

  const View = active ? getViewComponent(chamber.name, view.id) : null;

  return (
    <section className="feed-card">
      <header className="feed-card-header">
        <ChamberMark name={chamber.name} />
        <span className="feed-card-title">{view.label}</span>
        {reason && <span className="feed-card-reason">{reason}</span>}
        {!full && (
          <Link to={viewHref(chamber.name, view)} className="feed-card-open" aria-label={`Open ${view.label}`}>
            Open
          </Link>
        )}
      </header>
      <div className={full ? "feed-card-body feed-card-body--full" : "feed-card-body"}>
        {active && View ? (
          <ViewErrorBoundary chamber={chamber.name} viewId={view.id}>
            <Suspense fallback={<ViewLoading />}>
              <View />
            </Suspense>
          </ViewErrorBoundary>
        ) : (
          <OfflineHatch label={`${chamber.displayName} — ${view.label}`} />
        )}
      </div>
    </section>
  );
}
