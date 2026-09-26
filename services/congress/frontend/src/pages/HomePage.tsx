import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ChamberRegistryEntry, FeedItem } from "@congress/shared-types";
import { ChamberHeader, CapitolMark, ChamberMark, fetchRegistry, resolveChamberPath, useAppliedTheme, useCapitolSettings } from "@congress/congress-ui";
import { ViewSlot, viewHref } from "@/components/ViewSlot";
import { feedQueryKey, fetchFeed } from "@/lib/feedApi";

function findView(registry: ChamberRegistryEntry[] | undefined, chamber: string, viewId: string) {
  const entry = registry?.find((c) => c.name === chamber);
  const view = entry?.views?.find((v) => v.id === viewId);
  return entry && view ? { entry, view } : null;
}

// "Ask Congress" - hands the message to the chat page, which sends it (see
// ChatPage's `send` navigation state) so the thread, the live tool progress
// and the reply all show up in one place.
function Composer() {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  return (
    <form
      className="home-composer"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = text.trim();
        navigate("/chat", trimmed ? { state: { send: trimmed } } : undefined);
      }}
    >
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask Congress —" aria-label="Ask Congress" enterKeyHint="send" />
    </form>
  );
}

// The owner's pinned views - fixed shortcuts above the ranked feed, the way
// stories sit above a feed. Pinning happens in Settings -> Home.
function PinnedViews({ registry }: { registry: ChamberRegistryEntry[] | undefined }) {
  const { data: settings } = useCapitolSettings();
  const pinned = (settings?.pinnedViews ?? []).map((p) => findView(registry, p.chamber, p.viewId)).filter((v) => v !== null);

  return (
    <nav className="home-stories" aria-label="Pinned views">
      {pinned.map(({ entry, view }) => (
        <Link key={`${entry.name}:${view.id}`} to={viewHref(entry.name, view)} className="home-story">
          <span className="home-story-bubble">
            <ChamberMark name={entry.name} />
          </span>
          <span className="home-story-label">{view.label}</span>
        </Link>
      ))}
      <Link to="/settings?from=home" className="home-story home-story--add" aria-label="Pin a view">
        <span className="home-story-bubble">+</span>
        <span className="home-story-label">Pin</span>
      </Link>
    </nav>
  );
}

function FeedEntry({ item, registry }: { item: FeedItem; registry: ChamberRegistryEntry[] | undefined }) {
  const navigate = useNavigate();
  if (item.kind === "view") {
    const found = findView(registry, item.chamber, item.viewId);
    if (!found) return null;
    return <ViewSlot chamber={found.entry} view={found.view} reason={item.reason} />;
  }
  return (
    <section className="feed-card">
      <button type="button" className="feed-exhibit" onClick={() => navigate(resolveChamberPath(item.url, item.chamber, true))}>
        <ChamberMark name={item.chamber} />
        <span className="feed-exhibit-name">{item.name}</span>
        {item.reason && <span className="feed-card-reason">{item.reason}</span>}
      </button>
    </section>
  );
}

// Congress's home: a "For You" feed. The AI composer on top, the owner's
// pinned views, then every active Chamber's views and exhibits ranked by how
// much they matter right now (GET /congress/feed - the ranking itself lives
// server-side, see services/congress/src/feed.ts).
export function HomePage() {
  useAppliedTheme();
  const { data: registry } = useQuery({ queryKey: ["congress", "registry"], queryFn: fetchRegistry });
  const feed = useQuery({ queryKey: feedQueryKey, queryFn: fetchFeed, refetchInterval: 60_000 });

  return (
    <div className="chamber-shell">
      <ChamberHeader icon={<CapitolMark className="h-6 w-6 text-ink" />} title="Congress" titleHref="" />
      <main className="chamber-main home-main">
        <Composer />
        <PinnedViews registry={registry} />
        {feed.isLoading && <p className="font-mono text-sm text-dust">Loading —</p>}
        {feed.isError && <p className="font-mono text-sm text-alert">Couldn't load the feed.</p>}
        {feed.data && feed.data.length === 0 && <p className="font-mono text-sm text-dust">— Nothing here yet —</p>}
        <div className="home-feed">
          {(feed.data ?? []).map((item) => (
            <FeedEntry key={item.kind === "view" ? `v:${item.chamber}:${item.viewId}` : `e:${item.exhibitId}`} item={item} registry={registry} />
          ))}
        </div>
      </main>
    </div>
  );
}
