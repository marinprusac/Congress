import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { WidgetPreviewShell } from "@congress/exhibit-ui";
import { fetchEvents } from "@/lib/api";
import { formatWidgetEventTime } from "@/lib/datetime";

const WIDGET_WINDOW_DAYS = 14;
const MAX_EVENTS = 5;

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
    <WidgetPreviewShell
      label="Upcoming"
      addHref="/calendar/new"
      isLoading={isLoading}
      isError={isError}
      errorLabel="Calendar unavailable."
      isEmpty={events.length === 0}
      emptyLabel="— No upcoming events —"
    >
      {events.map((event) => (
        <a
          key={event.id}
          href={`/calendar/e/${event.accountId}/${encodeURIComponent(event.calendarId)}/${encodeURIComponent(event.id)}`}
          target="_top"
          className="block border-b border-dust py-1.5 first:pt-0 last:border-b-0 hover:text-accent"
        >
          <div className="font-display text-sm text-ink">{event.title}</div>
          <div className="font-mono text-[10px] text-dust">{formatWidgetEventTime(event)}</div>
        </a>
      ))}
    </WidgetPreviewShell>
  );
}
