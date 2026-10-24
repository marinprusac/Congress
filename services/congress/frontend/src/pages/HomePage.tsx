import { useRef, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FeedItem } from "@congress/shared-types";
import {
  ChamberHeader,
  preloadRoute,
  resolveChamberPath,
  sourceColorStyle,
  staggerDelayMs,
  StackLink,
  useAppliedTheme,
  useCapitolSettings,
  useFlipList,
  useSourceColor,
  useStackNav,
} from "@congress/congress-ui";
import { ViewSlot, viewHref } from "@/components/ViewSlot";
import { findCoreView, findView as findViewSource, useViewSources } from "@/views/coreViews";
import { HomeAsks } from "@/components/HomeAsks";
import { GearIcon } from "@/components/TabBar";
import { feedQueryKey, fetchFeed } from "@/lib/feedApi";
import { feedSlots } from "@/lib/feedLayout";
import { fetchTypes, TYPES_KEY } from "@/lib/recordsApi";
import { formatPreviewTime } from "@/lib/formatPreviewTime";

// One pinned view: its source square (coloured by its source) and label.
function PinnedView({ source, view }: { source: { name: string }; view: { id: string; label: string; fullPath?: string } }) {
  const color = useSourceColor(source.name);
  return (
    <StackLink to={viewHref(source.name, view)} className="home-pin" style={sourceColorStyle(color)}>
      <span className="home-pin-mark" />
      {view.label}
    </StackLink>
  );
}

// The owner's pinned views - fixed shortcuts under the nameplate, ahead of
// the ranked feed. Pinning happens in Settings -> Home.
function PinnedViews() {
  const { data: settings } = useCapitolSettings();
  const sources = useViewSources();
  const pinned = (settings?.pinnedViews ?? []).map((p) => findViewSource(sources, p.chamber, p.viewId)).filter((v) => v !== null);

  return (
    <nav className="home-rail" aria-label="Pinned views">
      {pinned.map(({ source, view }) => (
        <PinnedView key={`${source.name}:${view.id}`} source={source} view={view} />
      ))}
      <StackLink to="/settings?from=home" className="home-pin home-pin--add" aria-label="Pin a view">
        <span className="home-pin-mark" />
        Pin
      </StackLink>
    </nav>
  );
}

// A record: a kicker (its type, in the type's colour, and why it is here),
// then its own information inline. The whole card opens the record.
function RecordCard({ item, lead, typeLabel }: { item: Extract<FeedItem, { kind: "record" }>; lead: boolean; typeLabel?: string }) {
  const nav = useStackNav();
  const color = useSourceColor(item.chamber, item.type);
  const preview = item.preview;
  // The reason sits in the kicker, unless it only repeats the time (an
  // all-day event's "Today", or a range ending today).
  const time = preview?.time ? formatPreviewTime(preview.time) : undefined;
  const repeatsTime = item.reason === time || (preview?.time?.allDay && item.reason === "Today");
  const reason = item.reason && !repeatsTime ? item.reason : undefined;
  const href = resolveChamberPath(item.url, item.chamber);
  return (
    <section className={lead ? "feed-card feed-card--lead" : "feed-card"} style={sourceColorStyle(color)}>
      <button type="button" className="feed-record" onPointerDown={() => void preloadRoute(href)} onClick={() => nav.push(href)}>
        <span className="feed-kicker">
          <span className="feed-kicker-label">{typeLabel ?? item.type ?? item.chamber}</span>
          {reason && <span className="feed-kicker-reason">{reason}</span>}
        </span>
        <span className="feed-record-name">{preview?.title ?? item.name}</span>
        {time && <span className="feed-record-time">{time}</span>}
        {preview?.fields && preview.fields.length > 0 && <span className="feed-record-fields">{preview.fields.join(" · ")}</span>}
        {preview?.body && <span className="feed-record-body">{preview.body}</span>}
      </button>
    </section>
  );
}

function FeedEntry({ item, lead, typeLabel }: { item: FeedItem; lead: boolean; typeLabel?: string }) {
  if (item.kind === "view") {
    const core = findCoreView(item.chamber, item.viewId);
    if (!core?.view.Card) return null;
    return <ViewSlot source={core.source} view={core.view} Card={core.view.Card} reason={item.reason} />;
  }
  return <RecordCard item={item} lead={lead} typeLabel={typeLabel} />;
}

function feedKey(item: FeedItem): string {
  return item.kind === "view" ? `v:${item.chamber}:${item.viewId}` : `e:${item.recordId}`;
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

// Congress's home: a "For You" feed. The owner's pinned views, then every active Chamber's views and records ranked by how
// much they matter right now (GET /congress/feed - the ranking itself lives
// server-side, see services/congress/src/feed.ts).
export function HomePage() {
  useAppliedTheme();
  const feed = useQuery({ queryKey: feedQueryKey, queryFn: fetchFeed, refetchInterval: 60_000 });
  const keys = (feed.data ?? []).map(feedKey);
  const slots = feedSlots(feed.data ?? []);
  const { data: types } = useQuery({ queryKey: TYPES_KEY, queryFn: fetchTypes });
  const typeLabels = new Map((types ?? []).map((t) => [t.definition.slug, t.definition.label]));
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
        variant="nameplate"
        title="Congress"
        titleHref=""
        extraActions={
          <StackLink to="/settings" className="chamber-header-icon-link" aria-label="Settings">
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
          {(feed.data ?? []).map((item, i) => {
            const key = feedKey(item);
            const slot = slots[i] ?? "item";
            const introIndex = introKeys.current?.get(key);
            return (
              <div
                key={key}
                data-flip-key={key}
                className={`feed-slot feed-slot--${slot}${introIndex === undefined ? "" : " motion-rise"}`}
                style={introIndex === undefined ? undefined : ({ "--stagger": `${staggerDelayMs(introIndex)}ms` } as CSSProperties)}>
                <FeedEntry item={item} lead={slot === "lead"} typeLabel={item.kind === "record" && item.type ? typeLabels.get(item.type) : undefined} />
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
