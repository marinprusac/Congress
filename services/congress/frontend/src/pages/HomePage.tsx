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
  useFlipList,
  useSourceColor,
  useStackNav,
} from "@congress/congress-ui";
import { HomeAsks } from "@/components/HomeAsks";
import { feedQueryKey, fetchFeed } from "@/lib/feedApi";
import { feedSlots } from "@/lib/feedLayout";
import { fetchTypes, TYPES_KEY } from "@/lib/recordsApi";
import { formatPreviewTime } from "@/lib/formatPreviewTime";

// A record: a kicker (its type, in the type's colour, and why it is here),
// then its own information inline. The whole card opens the record.
function RecordCard({ item, lead, typeLabel }: { item: FeedItem; lead: boolean; typeLabel?: string }) {
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

function feedKey(item: FeedItem): string {
  return `e:${item.recordId}`;
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

// Congress's home: a "For You" feed. Every source's records ranked by how
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
      <ChamberHeader variant="nameplate" title="Congress" titleHref="" />
      <main className="chamber-main home-main">
        <HomeAsks />
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
                <RecordCard item={item} lead={slot === "lead"} typeLabel={item.type ? typeLabels.get(item.type) : undefined} />
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
