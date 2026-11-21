import { useRef, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChamberHeader, staggerDelayMs, useAppliedTheme, useFlipList } from "@congress/congress-ui";
import { HomeAsks } from "@/components/HomeAsks";
import { DashboardCard } from "@/components/DashboardCard";
import { dashboardQueryKey, fetchDashboard } from "@/lib/dashboardApi";

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

// Congress's home: the dashboard. Everything on it was put there by the AI
// (GET /congress/dashboard), which also takes it off again.
export function HomePage() {
  useAppliedTheme();
  const dash = useQuery({ queryKey: dashboardQueryKey, queryFn: fetchDashboard, refetchInterval: 60_000 });
  const keys = (dash.data ?? []).map((c) => `c:${c.id}`);
  const feedRef = useRef<HTMLDivElement>(null);
  useFlipList(feedRef, keys);
  // Cards rise in only when the dashboard arrives after a skeleton, not when
  // it was already cached (returning Home).
  const [introPending] = useState(() => !dash.data);
  const introKeys = useRef<Map<string, number> | null>(null);
  if (introPending && !introKeys.current && dash.data) introKeys.current = new Map(keys.map((k, i) => [k, i]));

  return (
    <div className="chamber-shell">
      <ChamberHeader variant="nameplate" title="Congress" titleHref="" />
      <main className="chamber-main home-main">
        <HomeAsks />
        {dash.isLoading && <FeedSkeleton />}
        {dash.isError && <p className="font-mono text-sm text-alert">Couldn't load the dashboard.</p>}
        {dash.data && dash.data.length === 0 && <p className="font-mono text-sm text-dust">— Nothing on the dashboard yet. Ask the AI to put something here. —</p>}
        <div className="home-feed" ref={feedRef}>
          {(dash.data ?? []).map((card) => {
            const key = `c:${card.id}`;
            const introIndex = introKeys.current?.get(key);
            return (
              <div
                key={key}
                data-flip-key={key}
                className={`feed-slot feed-slot--${card.size}${introIndex === undefined ? "" : " motion-rise"}`}
                style={introIndex === undefined ? undefined : ({ "--stagger": `${staggerDelayMs(introIndex)}ms` } as CSSProperties)}>
                <DashboardCard card={card} />
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
