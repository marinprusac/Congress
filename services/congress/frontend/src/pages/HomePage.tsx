import { useRef, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ChamberRegistryEntry, FeedItem } from "@congress/shared-types";
import {
  ChamberHeader,
  CapitolMark,
  ChamberMark,
  fetchRegistry,
  preloadRoute,
  resolveChamberPath,
  staggerDelayMs,
  StackLink,
  useAppliedTheme,
  useCapitolSettings,
  useFlipList,
  useStackNav,
} from "@congress/congress-ui";
import { ViewSlot, viewHref } from "@/components/ViewSlot";
import { findView as findViewSource, useViewSources } from "@/views/coreViews";
import { HomeAsks } from "@/components/HomeAsks";
import { GearIcon } from "@/components/TabBar";
import { feedQueryKey, fetchFeed } from "@/lib/feedApi";
import { formatPreviewTime } from "@/lib/formatPreviewTime";

function findView(registry: ChamberRegistryEntry[] | undefined, chamber: string, viewId: string) {
  const entry = registry?.find((c) => c.name === chamber);
  const view = entry?.views?.find((v) => v.id === viewId);
  return entry && view ? { entry, view } : null;
}

// The owner's pinned views - fixed shortcuts above the ranked feed, the way
// stories sit above a feed. Pinning happens in Settings -> Home.
function PinnedViews() {
  const { data: settings } = useCapitolSettings();
  const sources = useViewSources();
  const pinned = (settings?.pinnedViews ?? []).map((p) => findViewSource(sources, p.chamber, p.viewId)).filter((v) => v !== null);

  return (
    <nav className="home-stories" aria-label="Pinned views">
      {pinned.map(({ source, view }) => (
        <StackLink key={`${source.name}:${view.id}`} to={viewHref(source.name, view)} className="home-story">
          <span className="home-story-bubble">
            <ChamberMark name={source.name} />
          </span>
          <span className="home-story-label">{view.label}</span>
        </StackLink>
      ))}
      <StackLink to="/settings?from=home" className="home-story home-story--add" aria-label="Pin a view">
        <span className="home-story-bubble">+</span>
        <span className="home-story-label">Pin</span>
      </StackLink>
    </nav>
  );
}

function FeedEntry({ item, registry }: { item: FeedItem; registry: ChamberRegistryEntry[] | undefined }) {
  const nav = useStackNav();
  if (item.kind === "view") {
    const found = findView(registry, item.chamber, item.viewId);
    if (!found) return null;
    return <ViewSlot chamber={found.entry} view={found.view} reason={item.reason} />;
  }
  // The item's own information, inline - tapping still opens the exhibit.
  const preview = item.preview;
  // The title gets its line to itself; the reason joins the time below it,
  // unless it only repeats it (an all-day event's "Today").
  const time = preview?.time ? formatPreviewTime(preview.time) : undefined;
  const reason = item.reason && item.reason !== time ? item.reason : undefined;
  const href = resolveChamberPath(item.url, item.chamber, true);
  return (
    <section className="feed-card">
      <button type="button" className="feed-exhibit" onPointerDown={() => void preloadRoute(href)} onClick={() => nav.push(href)}>
        <span className="feed-exhibit-head">
          <ChamberMark name={item.chamber} />
          <span className="feed-exhibit-name">{preview?.title ?? item.name}</span>
        </span>
        {(time || reason) && (
          <span className="feed-exhibit-time">
            {time}
            {time && reason && " · "}
            {reason && <span className="feed-exhibit-reason">{reason}</span>}
          </span>
        )}
        {preview?.fields && preview.fields.length > 0 && <span className="feed-exhibit-fields">{preview.fields.join(" · ")}</span>}
        {preview?.body && <span className="feed-exhibit-body">{preview.body}</span>}
      </button>
    </section>
  );
}

function feedKey(item: FeedItem): string {
  return item.kind === "view" ? `v:${item.chamber}:${item.viewId}` : `e:${item.exhibitId}`;
}

// Card-shaped placeholders while the feed loads.
function FeedSkeleton() {
  return (
    <div className="home-feed" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="feed-card feed-skeleton">
          <div className="list-skeleton-bar list-skeleton-title" />
          <div className="list-skeleton-bar list-skeleton-subtitle" />
          <div className="list-skeleton-bar feed-skeleton-body" />
        </div>
      ))}
    </div>
  );
}

// Congress's home: a "For You" feed. The owner's pinned views, then every active Chamber's views and exhibits ranked by how
// much they matter right now (GET /congress/feed - the ranking itself lives
// server-side, see services/congress/src/feed.ts).
export function HomePage() {
  useAppliedTheme();
  const { data: registry } = useQuery({ queryKey: ["congress", "registry"], queryFn: fetchRegistry });
  const feed = useQuery({ queryKey: feedQueryKey, queryFn: fetchFeed, refetchInterval: 60_000 });
  const keys = (feed.data ?? []).map(feedKey);
  const feedRef = useRef<HTMLDivElement>(null);
  useFlipList(feedRef, keys);
  // Cards rise in only when the feed arrives after a skeleton, not when it
  // was already cached (returning Home).
  const [introPending] = useState(() => !feed.data);
  const introKeys = useRef<Map<string, number> | null>(null);
  if (introPending && !introKeys.current && feed.data) introKeys.current = new Map(keys.map((k, i) => [k, i]));

  return (
    <div className="chamber-shell">
      <ChamberHeader
        icon={<CapitolMark className="h-6 w-6 text-ink" />}
        title="Congress"
        titleHref=""
        extraActions={
          <StackLink to="/settings" className="home-settings-link" aria-label="Settings">
            <GearIcon />
          </StackLink>
        }
      />
      <main className="chamber-main home-main">
        <HomeAsks />
        <PinnedViews />
        {feed.isLoading && <FeedSkeleton />}
        {feed.isError && <p className="font-mono text-sm text-alert">Couldn't load the feed.</p>}
        {feed.data && feed.data.length === 0 && <p className="font-mono text-sm text-dust">— Nothing here yet —</p>}
        <div className="home-feed" ref={feedRef}>
          {(feed.data ?? []).map((item) => {
            const key = feedKey(item);
            const introIndex = introKeys.current?.get(key);
            return (
              <div
                key={key}
                data-flip-key={key}
                className={introIndex === undefined ? undefined : "motion-rise"}
                style={introIndex === undefined ? undefined : ({ "--stagger": `${staggerDelayMs(introIndex)}ms` } as CSSProperties)}>
                <FeedEntry item={item} registry={registry} />
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
