import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useShellHosted, resolveChamberPath } from "@congress/exhibit-ui";
import { fetchEvents, fetchEvent } from "@/lib/api";
import { groupEventsByDay, formatEventTime, formatDateRange } from "@/lib/datetime";

const WINDOW_DAYS = 30;
const SHIFT_DAYS = 14;

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function AgendaPage() {
  const [anchor, setAnchor] = useState(startOfToday);
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();

  const windowEnd = addDays(anchor, WINDOW_DAYS);
  const from = anchor.toISOString();
  const to = windowEnd.toISOString();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["events", from, to],
    queryFn: () => fetchEvents(from, to),
  });

  const groups = useMemo(() => groupEventsByDay(data?.events ?? []), [data]);

  // Matches EventViewPage's own queryKey exactly - it reads accountId back
  // out of the URL via useParams (always a string), not from the number
  // fetchEvent expects, so the key here has to use the string form too or
  // this prefetch just populates a cache entry the view page never sees.
  function prefetchEvent(accountId: number, calendarId: string, eventId: string) {
    queryClient.prefetchQuery({
      queryKey: ["events", String(accountId), calendarId, eventId],
      queryFn: () => fetchEvent(accountId, calendarId, eventId),
    });
  }

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2 border-b border-dust pb-4">
        <h2 className="font-display text-3xl text-ink">Agenda</h2>
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-xs text-dust">{formatDateRange(anchor, windowEnd)}</span>
          <div className="flex gap-3 font-mono text-xs uppercase tracking-wide text-slate">
            <button onClick={() => setAnchor((a) => addDays(a, -SHIFT_DAYS))} className="hover:text-accent">
              ← Prev
            </button>
            <button onClick={() => setAnchor(startOfToday())} className="hover:text-accent">
              Today
            </button>
            <button onClick={() => setAnchor((a) => addDays(a, SHIFT_DAYS))} className="hover:text-accent">
              Next →
            </button>
          </div>
        </div>
      </div>

      {data?.accountErrors.map((err) => (
        <div key={err.accountId} className="mb-4 border border-alert px-3 py-2 font-mono text-sm text-alert">
          "{err.label}" needs to be reconnected —{" "}
          <Link to={resolveChamberPath("/settings", "calendar", shellHosted)} className="underline">
            reconnect in Settings
          </Link>
        </div>
      ))}

      {isLoading && <p className="font-mono text-sm text-dust">Loading —</p>}
      {isError && <p className="font-mono text-sm text-alert">Failed to reach the Calendar API.</p>}
      {!isLoading && !isError && groups.length === 0 && (
        <p className="border-t border-dust px-1 py-3 font-mono text-sm text-dust">
          — No events in this window —
        </p>
      )}

      {groups.map((group) => (
        <div key={group.dateKey} className="border-t border-dust">
          <div className="px-1 py-2 font-mono text-xs uppercase tracking-widest text-dust">
            {group.dateLabel}
          </div>
          {group.events.map((event) => (
            <Link
              key={event.id}
              to={resolveChamberPath(
                `/e/${event.accountId}/${encodeURIComponent(event.calendarId)}/${encodeURIComponent(event.id)}`,
                "calendar",
                shellHosted
              )}
              onMouseEnter={() => prefetchEvent(event.accountId, event.calendarId, event.id)}
              onFocus={() => prefetchEvent(event.accountId, event.calendarId, event.id)}
              className="flex items-baseline gap-4 border-b border-dust px-1 py-3 hover:bg-ink/[0.03]"
            >
              <span className="w-28 shrink-0 font-mono text-xs text-dust">{formatEventTime(event)}</span>
              <span className="min-w-0 flex-1 font-display text-lg text-ink">{event.title}</span>
              <span className="shrink-0 font-mono text-xs text-dust">{event.calendarSummary}</span>
            </Link>
          ))}
        </div>
      ))}
    </section>
  );
}
