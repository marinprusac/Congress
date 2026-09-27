import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ListLoadingState } from "@congress/congress-ui";
import { fetchEvents } from "@/lib/api";
import { addDays, buildTimeline, isTentative } from "@/lib/calendarViews";
import { formatClockTime, formatDayLabel } from "@/lib/datetime";
import { useNow } from "@/lib/useNow";
import { CalendarViewHeader, eventColor, eventSwatchStyle, useEventLinks } from "@/components/CalendarViewHeader";

// How far ahead the Timeline lists - always anchored to today.
const WINDOW_DAYS = 30;

// The Timeline view: the coming days as a plain list - a header per day
// with something on it, that day's all-day events, then its timed events in
// order, and a "now" line through today. Read-only: tapping an event opens
// it; creating one is the home screen's "+".
export function TimelinePage() {
  const [from] = useState(() => addDays(new Date(), 0));
  const to = addDays(from, WINDOW_DAYS);
  const nowMs = useNow();
  const links = useEventLinks();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["events", from.toISOString(), to.toISOString()],
    queryFn: () => fetchEvents(from.toISOString(), to.toISOString()),
  });

  const days = useMemo(
    () => buildTimeline(data?.events ?? [], { from, days: WINDOW_DAYS, nowMs }),
    [data, from, nowMs]
  );

  return (
    <section>
      <CalendarViewHeader active="timeline" accountErrors={data?.accountErrors ?? []} />
      {isLoading && <ListLoadingState />}
      {isError && <p className="font-mono text-sm text-alert">Failed to reach the Calendar API.</p>}

      {!isLoading &&
        !isError &&
        days.map((day) => (
          <div key={day.dateKey} className="mb-6">
            <h2 className={`mb-1 font-mono text-[11px] uppercase tracking-wide ${day.isToday ? "text-accent" : "text-dust"}`}>
              {day.isToday ? "Today · " : ""}
              {formatDayLabel(day.dateKey, nowMs)}
            </h2>

            {day.allDay.length > 0 && (
              <div className="mb-1 flex flex-wrap gap-1.5 py-1">
                {day.allDay.map((event) => (
                  <Link
                    key={event.id}
                    to={links.href(event)}
                    onMouseEnter={() => links.prefetch(event)}
                    onFocus={() => links.prefetch(event)}
                    className={`px-2 py-0.5 font-mono text-[11px] ${isTentative(event) ? "text-ink/60" : "text-ink"}`}
                    style={eventSwatchStyle(event, isTentative(event))}
                  >
                    {event.title}
                  </Link>
                ))}
              </div>
            )}

            {day.entries.map((entry) => {
              if (entry.kind === "now") {
                return (
                  <div key="now" className="flex items-center gap-3 py-1" aria-label="Now">
                    <span className="w-16 shrink-0 text-right font-mono text-[10px] font-semibold text-alert">
                      {formatClockTime(entry.nowMs)}
                    </span>
                    <span className="relative h-px flex-1 bg-alert">
                      <span className="absolute -left-[3px] -top-[2.5px] h-1.5 w-1.5 rounded-full bg-alert" />
                    </span>
                  </div>
                );
              }

              const { event, past, ongoing } = entry;
              const tentative = isTentative(event);
              const place = event.location?.trim() ?? "";
              return (
                <Link
                  key={event.id}
                  to={links.href(event)}
                  onMouseEnter={() => links.prefetch(event)}
                  onFocus={() => links.prefetch(event)}
                  className={`flex items-stretch gap-3 py-1.5 hover:bg-ink/[0.03] ${past ? "opacity-50" : ""}`}
                >
                  <span className="w-16 shrink-0 pt-0.5 text-right font-mono text-[11px] leading-tight text-dust">
                    <span className="block">{formatClockTime(new Date(event.start).getTime())}</span>
                    <span className="block text-dust/60">{formatClockTime(new Date(event.end).getTime())}</span>
                  </span>
                  <span
                    className={`min-w-0 flex-1 border-l-2 pl-3 ${tentative ? "border-dashed" : ""} ${ongoing ? "bg-accent/[0.06]" : ""}`}
                    style={{ borderColor: eventColor(event) }}
                  >
                    <span className={`block truncate font-display text-base leading-snug ${tentative ? "text-ink/60" : "text-ink"}`}>
                      {event.title}
                    </span>
                    {place && <span className="block truncate font-mono text-[11px] text-dust">{place}</span>}
                  </span>
                </Link>
              );
            })}
          </div>
        ))}
    </section>
  );
}
