import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchEvents } from "@/lib/api";
import { groupEventsByDay, formatEventTime } from "@/lib/datetime";

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

  const from = anchor.toISOString();
  const to = addDays(anchor, WINDOW_DAYS).toISOString();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["events", from, to],
    queryFn: () => fetchEvents(from, to),
  });

  const groups = useMemo(() => groupEventsByDay(data?.events ?? []), [data]);

  return (
    <section>
      <div className="mb-6 flex items-baseline justify-between border-b border-dust pb-4">
        <h2 className="font-display text-3xl text-ink">Agenda</h2>
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

      {data?.accountErrors.map((err) => (
        <div key={err.accountId} className="mb-4 border border-alert px-3 py-2 font-mono text-sm text-alert">
          "{err.label}" needs to be reconnected —{" "}
          <Link to="/settings" className="underline">
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
              to={`/e/${event.accountId}/${encodeURIComponent(event.calendarId)}/${encodeURIComponent(event.id)}/edit`}
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
