import { Component, Suspense, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { ChamberMark, resolveChamberPath, StackLink } from "@congress/congress-ui";
import type { ManifestView } from "@congress/shared-types";

class ViewErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return <p className="font-mono text-xs text-alert">This view failed to load.</p>;
    return this.props.children;
  }
}

// Views that have already appeared once this session; only a first
// appearance fades in, so returning Home doesn't replay it.
const shownViews = new Set<string>();

function FirstShowFade({ id, children }: { id: string; children: ReactNode }) {
  const [first] = useState(() => !shownViews.has(id));
  useEffect(() => {
    shownViews.add(id);
  }, [id]);
  return first ? <div className="motion-fade-in">{children}</div> : <>{children}</>;
}

function ViewLoading() {
  return <div className="h-full w-full animate-pulse bg-ink/[0.04]" aria-hidden="true" />;
}

export function viewHref(source: string, view: Pick<ManifestView, "id" | "fullPath">): string {
  return view.fullPath ? resolveChamberPath(view.fullPath, source) : `/view/${source}/${view.id}`;
}

// Congress's frame around one view card: the source's mark, the view's
// label, why it's in the feed right now, and a way into the full view.
export function ViewSlot({
  source,
  view,
  reason,
  full = false,
  Card,
}: {
  source: { name: string };
  view: ManifestView;
  reason?: string;
  // The card is the whole page (/view/:source/:viewId), not a feed item.
  full?: boolean;
  Card: ComponentType;
}) {
  // A view with nothing to show inline has no place in the feed (it's
  // reached through Search and the pinned row) - see rankFeed.
  if (!view.card) return null;

  return (
    <section className="feed-card">
      <header className="feed-card-header">
        <ChamberMark name={source.name} />
        <span className="feed-card-title">{view.label}</span>
        {reason && <span className="feed-card-reason">{reason}</span>}
        {!full && (
          <StackLink to={viewHref(source.name, view)} className="feed-card-open" aria-label={`Open ${view.label}`}>
            Open
          </StackLink>
        )}
      </header>
      <div className={full ? "feed-card-body feed-card-body--full" : "feed-card-body"}>
        <ViewErrorBoundary>
          <Suspense fallback={<ViewLoading />}>
            <FirstShowFade id={`${source.name}:${view.id}`}>
              <Card />
            </FirstShowFade>
          </Suspense>
        </ViewErrorBoundary>
      </div>
    </section>
  );
}
