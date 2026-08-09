import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchEvents } from "@/lib/api";
import { formatEventTime } from "@/lib/datetime";

const WIDGET_WINDOW_DAYS = 14;
const MAX_EVENTS = 5;

// Rendered chrome-free — this page is embedded directly as Capitol's
// homepage widget for this Chamber (via an iframe at chamber.routes.widget),
// not visited on its own. Links use target="_top" so a click breaks out of
// the iframe and navigates Capitol's own tab, rather than routing inside
// the small embedded frame.
export function WidgetPreviewPage() {
  // Computed once per mount, not per render — recomputing from Date.now()
  // directly in the render body would change the query key on every render
  // (react-query treats it as a brand new query), and each resolved fetch
  // triggers a re-render that computes yet another new key, looping forever.
  const [{ from, to }] = useState(() => ({
    from: new Date().toISOString(),
    to: new Date(Date.now() + WIDGET_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  }));

  const { data, isLoading, isError } = useQuery({
    queryKey: ["events", "widget", from, to],
    queryFn: () => fetchEvents(from, to),
  });

  const events = data?.events.slice(0, MAX_EVENTS) ?? [];

  return (
    <div className="flex h-screen flex-col bg-parchment p-3 text-ink">
      <div className="mb-2 flex shrink-0 items-baseline justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-dust">Upcoming</p>
        <a
          href="/calendar/new"
          target="_top"
          className="font-mono text-[10px] uppercase tracking-wide text-accent hover:underline"
        >
          + New
        </a>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && <p className="font-mono text-xs text-dust">Loading —</p>}
        {isError && <p className="font-mono text-xs text-alert">Calendar unavailable.</p>}
        {!isLoading && !isError && events.length === 0 && (
          <p className="font-mono text-xs text-dust">— No upcoming events —</p>
        )}
        {!isLoading &&
          !isError &&
          events.map((event) => (
            <a
              key={event.id}
              href={`/calendar/e/${event.accountId}/${encodeURIComponent(event.calendarId)}/${encodeURIComponent(event.id)}`}
              target="_top"
              className="block border-b border-dust py-1.5 first:pt-0 last:border-b-0 hover:text-accent"
            >
              <div className="font-display text-sm text-ink">{event.title}</div>
              <div className="font-mono text-[10px] text-dust">{formatEventTime(event)}</div>
            </a>
          ))}
      </div>
    </div>
  );
}
