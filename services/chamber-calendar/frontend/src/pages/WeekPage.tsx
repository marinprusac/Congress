import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ListLoadingState } from "@congress/congress-ui";
import { fetchEvents } from "@/lib/api";
import { addDays, buildWeek, isTentative, localDateKey, MIN_BLOCK_MINUTES, startOfWeek } from "@/lib/calendarViews";
import { formatClockTime, formatWeekMonths } from "@/lib/datetime";
import { useNow } from "@/lib/useNow";
import { CalendarViewHeader, eventSwatchStyle, useEventLinks } from "@/components/CalendarViewHeader";

const HOUR_PX = 44;
const GRID_COLUMNS = "2rem repeat(7, minmax(0, 1fr))";
// Where the grid opens scrolled to on a week other than this one.
const DEFAULT_SCROLL_HOUR = 7;

const WEEKDAY_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const HOUR_FORMAT = new Intl.DateTimeFormat(undefined, { hour: "numeric" });
const HOUR_LABELS = Array.from({ length: 23 }, (_, i) => HOUR_FORMAT.format(new Date(2000, 0, 1, i + 1)));

// Hour lines, drawn as a background rather than 24 elements per day.
const HOUR_LINES = `repeating-linear-gradient(to bottom, transparent 0 ${HOUR_PX - 1}px, color-mix(in srgb, var(--color-dust) 25%, transparent) ${HOUR_PX - 1}px ${HOUR_PX}px)`;

// The Week view: seven days side by side on a plain hour grid, like Google
// Calendar's week view - every event at its real clock position, overlaps
// side by side. Read-only: tapping an event opens it.
export function WeekPage() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const weekEnd = addDays(weekStart, 7);
  const nowMs = useNow();
  const links = useEventLinks();
  const scrollRef = useRef<HTMLDivElement>(null);

  const from = weekStart.toISOString();
  const to = weekEnd.toISOString();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["events", from, to],
    queryFn: () => fetchEvents(from, to),
    placeholderData: keepPreviousData,
  });

  const days = useMemo(() => buildWeek(data?.events ?? [], weekStart), [data, weekStart]);
  const todayKey = localDateKey(new Date(nowMs));
  const hasAllDay = days.some((day) => day.allDay.length > 0);
  const showsToday = days.some((day) => day.dateKey === todayKey);

  // The grid scrolls inside its own box (so the day header can stick),
  // sized to end just above the tab bar - measured, since the chrome above
  // it differs between phone and desktop.
  const gridReady = !isLoading && !isError;
  // (--mobile-nav-height is itself a calc(), so CSS does that subtraction.)
  const [gridHeight, setGridHeight] = useState<string>();
  useLayoutEffect(() => {
    if (!gridReady) return;
    const measure = () => {
      const el = scrollRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      setGridHeight(`max(20rem, calc(${window.innerHeight - top - 8}px - var(--mobile-nav-height, 0px)))`);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [gridReady]);

  // Open each week scrolled to something useful: an hour before now on this
  // week, the start of a working day on any other.
  useEffect(() => {
    if (!gridReady || !scrollRef.current) return;
    const now = new Date();
    const hour = showsToday ? Math.max(0, now.getHours() - 1) : DEFAULT_SCROLL_HOUR;
    scrollRef.current.scrollTop = hour * HOUR_PX;
    // Only when the week (or readiness) changes, not every minute's tick.
  }, [weekStart, gridReady]);

  return (
    <section>
      <CalendarViewHeader active="week" accountErrors={data?.accountErrors ?? []} />

      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-lg text-ink">{formatWeekMonths(weekStart, addDays(weekStart, 6))}</h2>
        <div className="flex shrink-0 items-center gap-1 font-mono text-xs">
          <button type="button" className="px-2 py-1 text-dust hover:text-ink" aria-label="Previous week" onClick={() => setWeekStart((w) => addDays(w, -7))}>
            ‹
          </button>
          <button type="button" className="border border-dust/40 px-2 py-1 text-ink hover:border-ink" onClick={() => setWeekStart(startOfWeek(new Date()))}>
            Today
          </button>
          <button type="button" className="px-2 py-1 text-dust hover:text-ink" aria-label="Next week" onClick={() => setWeekStart((w) => addDays(w, 7))}>
            ›
          </button>
        </div>
      </div>

      {isLoading && <ListLoadingState />}
      {isError && <p className="font-mono text-sm text-alert">Failed to reach the Calendar API.</p>}

      {gridReady && (
        <div
          ref={scrollRef}
          className="overflow-y-auto border-t border-dust/30"
          style={{ height: gridHeight }}
        >
          <div className="sticky top-0 z-20 bg-parchment">
            <div className="grid" style={{ gridTemplateColumns: GRID_COLUMNS }}>
              <div />
              {days.map((day) => {
                const isToday = day.dateKey === todayKey;
                return (
                  <div key={day.dateKey} className="py-1 text-center">
                    <div className={`font-mono text-[10px] uppercase ${isToday ? "text-accent" : "text-dust"}`}>{WEEKDAY_FORMAT.format(day.date)}</div>
                    <div
                      className={`mx-auto grid h-7 w-7 place-items-center rounded-full font-display text-base ${
                        isToday ? "bg-accent text-parchment" : "text-ink"
                      }`}
                    >
                      {day.date.getDate()}
                    </div>
                  </div>
                );
              })}
            </div>
            {hasAllDay && (
              <div className="grid border-b border-dust/30 pb-1" style={{ gridTemplateColumns: GRID_COLUMNS }}>
                <div />
                {days.map((day) => (
                  <div key={day.dateKey} className="min-w-0 space-y-px px-px">
                    {day.allDay.map((event) => (
                      <Link
                        key={event.id}
                        to={links.href(event)}
                        onMouseEnter={() => links.prefetch(event)}
                        onFocus={() => links.prefetch(event)}
                        className={`block truncate px-1 text-[10px] leading-4 ${isTentative(event) ? "text-ink/60" : "text-ink"}`}
                        style={eventSwatchStyle(event, isTentative(event))}
                        title={event.title}
                      >
                        {event.title}
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid" style={{ gridTemplateColumns: GRID_COLUMNS, height: 24 * HOUR_PX }}>
            <div className="relative" aria-hidden="true">
              {HOUR_LABELS.map((label, i) => (
                <span
                  key={label}
                  className="absolute right-1 -translate-y-1/2 font-mono text-[9px] text-dust"
                  style={{ top: (i + 1) * HOUR_PX }}
                >
                  {label}
                </span>
              ))}
            </div>

            {days.map((day) => {
              const isToday = day.dateKey === todayKey;
              const nowMin = (nowMs - day.date.getTime()) / 60000;
              return (
                <div key={day.dateKey} className="relative border-l border-dust/20" style={{ backgroundImage: HOUR_LINES }}>
                  {day.blocks.map((block) => {
                    const { event } = block;
                    const tentative = isTentative(event);
                    const height = (Math.max(block.endMin - block.startMin, MIN_BLOCK_MINUTES) / 60) * HOUR_PX - 1;
                    return (
                      <Link
                        key={event.id}
                        to={links.href(event)}
                        onMouseEnter={() => links.prefetch(event)}
                        onFocus={() => links.prefetch(event)}
                        className={`absolute overflow-hidden px-0.5 text-[10px] leading-tight hover:z-10 ${tentative ? "text-ink/60" : "text-ink"}`}
                        style={{
                          ...eventSwatchStyle(event, tentative),
                          top: (block.startMin / 60) * HOUR_PX,
                          height,
                          left: `calc(${(block.column / block.columns) * 100}% + 1px)`,
                          width: `calc(${100 / block.columns}% - 2px)`,
                        }}
                        title={`${event.title} · ${formatClockTime(new Date(event.start).getTime())}`}
                      >
                        <span className="block break-normal font-medium">{event.title}</span>
                        {height >= 2 * HOUR_PX * 0.75 && (
                          <span className="block font-mono text-[9px] text-dust">{formatClockTime(new Date(event.start).getTime())}</span>
                        )}
                      </Link>
                    );
                  })}
                  {isToday && (
                    <div className="pointer-events-none absolute inset-x-0 z-10 h-px bg-alert" style={{ top: (nowMin / 60) * HOUR_PX }} aria-hidden="true">
                      <span className="absolute -left-[3px] -top-[2.5px] h-1.5 w-1.5 rounded-full bg-alert" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
