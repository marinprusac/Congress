import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChamberHeader, ChamberMark, ListLoadingState, StackLink, useAppliedTheme, useBackNavigation } from "@congress/congress-ui";
import { fetchRecord } from "@/lib/recordsApi";
import { addDays, buildTimeline, buildWeek, localDateKey, MIN_BLOCK_MINUTES, startOfWeek, type CalendarItem } from "./calendarViews";
import { formatClockTime, formatDayLabel, formatWeekMonths } from "./format";
import { useNow } from "./useNow";
import { useCalendarWindow } from "./data";

// The calendar's two views over Event records: /events (Timeline) and
// /events/week. Read-only; an event opens its record page.

const VIEWS = [
  { id: "timeline", label: "Timeline", path: "/events" },
  { id: "week", label: "Week", path: "/events/week" },
] as const;

function CalendarViewHeader({ active, problems }: { active: "timeline" | "week"; problems: { id: number; label: string; error: string }[] }) {
  return (
    <>
      <div className="mb-4 flex gap-4 font-mono text-xs uppercase tracking-wide" role="tablist">
        {VIEWS.map((view) => (
          <StackLink
            key={view.id}
            to={view.path}
            replace
            role="tab"
            aria-selected={view.id === active}
            className={view.id === active ? "border-b-2 border-accent pb-1 text-ink" : "pb-1 text-dust hover:text-ink"}
          >
            {view.label}
          </StackLink>
        ))}
      </div>
      {problems.map((p) => (
        <div key={p.id} className="mb-4 border border-alert px-3 py-2 font-mono text-sm text-alert">
          {p.error} —{" "}
          <StackLink to="/settings?from=accounts" className="underline">
            Settings
          </StackLink>
        </div>
      ))}
    </>
  );
}

// Warms the record page's query on hover/focus.
function useEventLinks() {
  const queryClient = useQueryClient();
  return { prefetch: (event: CalendarItem) => void queryClient.prefetchQuery({ queryKey: ["record", event.id], queryFn: () => fetchRecord(event.id) }) };
}

function colorOf(event: CalendarItem): string {
  return event.color ?? "var(--color-accent)";
}

// A light wash of the event's color with a solid (or dashed, if tentative) left edge.
function eventSwatchStyle(event: CalendarItem, tentative: boolean): CSSProperties {
  const color = colorOf(event);
  return {
    borderLeft: `2px ${tentative ? "dashed" : "solid"} ${color}`,
    backgroundColor: `color-mix(in srgb, ${color} ${tentative ? 8 : 20}%, var(--color-parchment))`,
  };
}

function CalendarShell({ children }: { children: ReactNode }) {
  useAppliedTheme();
  const back = useBackNavigation();
  return (
    <div className="chamber-shell">
      <ChamberHeader icon={<ChamberMark name="events" className="h-6 w-6 text-ink" />} title="Calendar" titleHref="" onBack={back} />
      <main className="chamber-main">{children}</main>
    </div>
  );
}

export function TimelinePage() {
  return (
    <CalendarShell>
      <TimelineView />
    </CalendarShell>
  );
}

export function WeekPage() {
  return (
    <CalendarShell>
      <WeekView />
    </CalendarShell>
  );
}

// How far ahead the Timeline lists - always anchored to today.
const WINDOW_DAYS = 30;

// The Timeline view: the coming days as a plain list - a header per day
// with something on it, that day's all-day events, then its timed events in
// order, and a "now" line through today. Read-only: tapping an event opens
// it; creating one is the home screen's "+".
function TimelineView() {
  const [from] = useState(() => addDays(new Date(), 0));
  const to = addDays(from, WINDOW_DAYS);
  const nowMs = useNow();
  const links = useEventLinks();

  const { items, isLoading, isError, problems } = useCalendarWindow(from, to);
  const days = useMemo(() => buildTimeline(items, { from, days: WINDOW_DAYS, nowMs }), [items, from, nowMs]);

  return (
    <section>
      <CalendarViewHeader active="timeline" problems={problems} />
      {isLoading && <ListLoadingState />}
      {isError && <p className="font-mono text-sm text-alert">Couldn't load events.</p>}

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
                  <StackLink
                    key={event.id}
                    to={`/e/${event.id}`}
                    onMouseEnter={() => links.prefetch(event)}
                    onFocus={() => links.prefetch(event)}
                    className={`px-2 py-0.5 font-mono text-[11px] ${event.tentative ? "text-ink/60" : "text-ink"}`}
                    style={eventSwatchStyle(event, event.tentative)}
                  >
                    {event.title}
                  </StackLink>
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
              const tentative = event.tentative;
              const place = event.location;
              return (
                <StackLink
                  key={event.id}
                  to={`/e/${event.id}`}
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
                    style={{ borderColor: colorOf(event) }}
                  >
                    <span className={`block truncate font-display text-base leading-snug ${tentative ? "text-ink/60" : "text-ink"}`}>
                      {event.title}
                    </span>
                    {place && <span className="block truncate font-mono text-[11px] text-dust">{place}</span>}
                  </span>
                </StackLink>
              );
            })}
          </div>
        ))}
    </section>
  );
}

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
function WeekView() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const weekEnd = addDays(weekStart, 7);
  const nowMs = useNow();
  const links = useEventLinks();
  const scrollRef = useRef<HTMLDivElement>(null);

  const { items, isLoading, isError, problems } = useCalendarWindow(weekStart, weekEnd);
  const days = useMemo(() => buildWeek(items, weekStart), [items, weekStart]);
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
    if (!gridReady || !gridHeight || !scrollRef.current) return;
    const now = new Date();
    const hour = showsToday ? Math.max(0, now.getHours() - 1) : DEFAULT_SCROLL_HOUR;
    scrollRef.current.scrollTop = hour * HOUR_PX;
    // Only when the week changes or the grid gets its height (it can't scroll before), not every minute's tick.
  }, [weekStart, gridReady, gridHeight !== undefined]);

  return (
    <section>
      <CalendarViewHeader active="week" problems={problems} />

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
      {isError && <p className="font-mono text-sm text-alert">Couldn't load events.</p>}

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
                      <StackLink
                        key={event.id}
                        to={`/e/${event.id}`}
                        onMouseEnter={() => links.prefetch(event)}
                        onFocus={() => links.prefetch(event)}
                        className={`block truncate px-1 text-[10px] leading-4 ${event.tentative ? "text-ink/60" : "text-ink"}`}
                        style={eventSwatchStyle(event, event.tentative)}
                        title={event.title}
                      >
                        {event.title}
                      </StackLink>
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
                    const tentative = event.tentative;
                    const height = (Math.max(block.endMin - block.startMin, MIN_BLOCK_MINUTES) / 60) * HOUR_PX - 1;
                    return (
                      <StackLink
                        key={event.id}
                        to={`/e/${event.id}`}
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
                      </StackLink>
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
