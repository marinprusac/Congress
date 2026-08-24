import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useShellHosted, resolveChamberPath, ListSearchInput, ListLoadingState, ListErrorState, ListEmptyState } from "@congress/congress-ui";
import { fetchEvents, fetchEvent, searchEvents } from "@/lib/api";
import {
  buildAgendaTimeline,
  formatEventStartTime,
  formatEventEndTime,
  formatWidgetEventTime,
  formatSkippedDuration,
  formatGapDuration,
  formatClockTime,
} from "@/lib/datetime";

// Below this, a gap's blank space stays unlabeled - long enough to be worth
// naming, but a 5-minute breather between back-to-back meetings doesn't
// need its own caption.
const GAP_LABEL_THRESHOLD_MINUTES = 20;

// How often the now-indicator's position is recomputed while the page sits
// open - fine-grained enough that it visibly moves over a session, without
// re-rendering every few seconds for a line only ~1 pixel/minute wide.
const NOW_REFRESH_MS = 60_000;

// The agenda is always anchored to today with no way to page it forward or
// back - just a long enough forward window to be genuinely useful.
const WINDOW_DAYS = 30;

// This is a rough visualization, not a precise clock - so a block or gap's
// real duration maps to pixels via sqrt(hours) rather than 1:1 with
// wall-clock time: 1 hour renders as 1 "unit" (PX_PER_HOUR), 4 hours as 2
// units, 15 minutes as half a unit. A 4-hour meeting still visibly takes
// more room than a 1-hour one, just not a literal 4x more - and a 15-minute
// meeting or a slow afternoon both get real, legible space instead of
// being crushed or blown out by strict linear scaling. Applies uniformly to
// every duration this page turns into a height: gaps, cut-eligible spans
// before they're evaluated against the threshold, and event blocks alike.
const PX_PER_HOUR = 48;
function durationPx(minutes: number): number {
  return Math.sqrt(Math.max(0, minutes) / 60) * PX_PER_HOUR;
}

// A block never renders shorter than this, regardless of the event's own
// duration - short meetings still need room for a title and calendar name.
const MIN_BLOCK_HEIGHT_PX = 24;
// A cut marker's fixed height - deliberately smaller than a "real" gap of
// comparable rendered size, so it reads as compressed rather than as an
// unusually short lull.
const CUT_HEIGHT_PX = 28;

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

// An invitation you haven't settled on yet - hasn't been declined (that's
// filtered out of the agenda entirely server-side, see listCachedEvents) but
// also not a confirmed "yes", so it renders as a dashed, lighter block: a
// potential slot on the day rather than a commitment.
function isUnconfirmed(event: { attendance: { isInvitation: boolean; responseStatus: string | null } }): boolean {
  return (
    event.attendance.isInvitation &&
    (event.attendance.responseStatus === "needsAction" || event.attendance.responseStatus === "tentative")
  );
}

export function AgendaPage() {
  const [anchor] = useState(startOfToday);
  const [query, setQuery] = useState("");
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();

  const windowEnd = addDays(anchor, WINDOW_DAYS);
  const from = anchor.toISOString();
  const to = windowEnd.toISOString();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["events", from, to],
    queryFn: () => fetchEvents(from, to),
  });

  // Search runs across the whole calendar (not just the currently-paged
  // window), so it replaces the proportional timeline with a flat
  // chronological list while active, same as the windowed toolbar/nav
  // stepping through Prev/Today/Next doesn't apply to it either.
  const trimmedQuery = query.trim();
  const isSearching = trimmedQuery.length > 0;
  const { data: searchData, isLoading: isSearchLoading, isError: isSearchError } = useQuery({
    queryKey: ["events", "search", trimmedQuery],
    queryFn: () => searchEvents(trimmedQuery),
    enabled: isSearching,
  });

  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), NOW_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  // windowEnd is a pure function of anchor (see addDays above), so anchor
  // alone is a sufficient/complete dependency without also listing the new
  // Date object windowEnd happens to be on every render.
  const timeline = useMemo(
    () =>
      buildAgendaTimeline(data?.events ?? [], {
        nowMs: nowTick,
        windowStartMs: anchor.getTime(),
        windowEndMs: windowEnd.getTime(),
      }),
    [data, nowTick, anchor]
  );
  const isEmpty = (data?.events.length ?? 0) === 0;
  // A leading now-marker (kind "now") can sit before the first date caption
  // without disturbing layout (it renders at zero height) - the caption
  // right after it should still get the "top of page" spacing, not the one
  // meant for a date change further down.
  const firstContentIndex = timeline.findIndex((entry) => entry.kind !== "now");

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

  function eventHref(event: { accountId: number; calendarId: string; id: string }) {
    return resolveChamberPath(
      `/e/${event.accountId}/${encodeURIComponent(event.calendarId)}/${encodeURIComponent(event.id)}`,
      "calendar",
      shellHosted
    );
  }

  return (
    <section className="list-page">
      <ListSearchInput
        value={query}
        onChange={setQuery}
        placeholder="Search events —"
        newHref={resolveChamberPath("/new", "calendar", shellHosted)}
      />

      {!isSearching &&
        data?.accountErrors.map((err) => (
          <div key={err.accountId} className="mb-4 border border-alert px-3 py-2 font-mono text-sm text-alert">
            "{err.label}" needs to be reconnected —{" "}
            <Link to={resolveChamberPath("/settings", "calendar", shellHosted)} className="underline">
              reconnect in Settings
            </Link>
          </div>
        ))}

      {isSearching && (
        <>
          {isSearchLoading && <ListLoadingState />}
          {isSearchError && <ListErrorState label="Calendar" />}
          {!isSearchLoading && !isSearchError && (searchData?.events.length ?? 0) === 0 && (
            <ListEmptyState label="events" hasQuery />
          )}
          {!isSearchLoading &&
            !isSearchError &&
            searchData?.events.map((event) => (
              <Link
                key={event.id}
                to={eventHref(event)}
                onMouseEnter={() => prefetchEvent(event.accountId, event.calendarId, event.id)}
                onFocus={() => prefetchEvent(event.accountId, event.calendarId, event.id)}
                className="flex items-baseline gap-4 border-b border-dust px-1 py-3 hover:bg-ink/[0.03]"
              >
                <span className="w-28 shrink-0 font-mono text-xs text-dust">{formatWidgetEventTime(event)}</span>
                <span className="min-w-0 flex-1 font-display text-lg text-ink">{event.title}</span>
                <span className="shrink-0 font-mono text-xs text-dust">{event.calendarSummary}</span>
              </Link>
            ))}
        </>
      )}

      {!isSearching && isLoading && <ListLoadingState />}
      {!isSearching && isError && <p className="font-mono text-sm text-alert">Failed to reach the Calendar API.</p>}
      {!isSearching && !isLoading && !isError && isEmpty && (
        <p className="border-t border-dust px-1 py-3 font-mono text-sm text-dust">
          — No events in this window —
        </p>
      )}

      {!isSearching &&
        !isLoading &&
        !isError &&
        timeline.map((entry, index) => {
          switch (entry.kind) {
            case "date": {
              // The label sits in the time gutter, left of the line, right-
              // aligned exactly like an event's own start/end time - not
              // squeezed up against the line's left edge in the content
              // column, which read as cramped with no breathing room.
              // The gutter's own padding (not the line-bearing div's) is
              // what drives the row's total height here, via the two
              // columns' default flex stretch - see the earlier bug this
              // fixed: padding placed on the outer row instead of a column
              // that stretch actually sizes against leaves the line short of
              // the row's true full height.
              const topPad = index === firstContentIndex ? "pt-1" : "pt-5";
              return (
                <div key={entry.key} className="flex gap-3 px-1">
                  <div
                    className={`w-16 shrink-0 ${topPad} pb-1 text-right font-mono text-[10px] leading-tight uppercase tracking-wide text-dust`}
                  >
                    {entry.label}
                  </div>
                  <div className="relative flex-1" aria-hidden="true">
                    <span className="absolute inset-y-0 left-0 border-l-2 border-dust/30" />
                  </div>
                </div>
              );
            }

            case "allday":
              return (
                <div key={entry.key} className="flex gap-3 px-1">
                  <div className="w-16 shrink-0" aria-hidden="true" />
                  <div className="relative flex flex-1 flex-wrap gap-2 pb-2">
                    <span className="absolute inset-y-0 left-0 border-l-2 border-accent" aria-hidden="true" />
                    {entry.events.map((event) => {
                      const unconfirmed = isUnconfirmed(event);
                      return (
                        <Link
                          key={event.id}
                          to={eventHref(event)}
                          onMouseEnter={() => prefetchEvent(event.accountId, event.calendarId, event.id)}
                          onFocus={() => prefetchEvent(event.accountId, event.calendarId, event.id)}
                          className={`border-l-2 px-2 py-1 font-mono text-[11px] hover:bg-accent/[0.16] ${
                            unconfirmed ? "border-dashed border-accent/50 bg-accent/[0.03] text-ink/70" : "border-accent bg-accent/[0.08] text-ink"
                          }`}
                        >
                          {event.title}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );

            case "gap":
              return (
                <div key={entry.key} className="flex gap-3 px-1" style={{ height: Math.max(4, durationPx(entry.minutes)) }}>
                  <div className="w-16 shrink-0" aria-hidden="true" />
                  <div className="relative flex-1">
                    <span className="absolute inset-y-0 left-0 border-l-2 border-dust/30" aria-hidden="true" />
                    {entry.minutes >= GAP_LABEL_THRESHOLD_MINUTES && (
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-dust/50">
                        {formatGapDuration(entry.minutes)}
                      </span>
                    )}
                  </div>
                </div>
              );

            case "cut":
              return (
                <div
                  key={entry.key}
                  className="flex gap-3 px-1"
                  style={{ height: CUT_HEIGHT_PX }}
                  title={formatSkippedDuration(entry.minutes)}
                >
                  <div className="w-16 shrink-0" aria-hidden="true" />
                  <div className="relative flex-1" aria-hidden="true">
                    {/* The line itself, broken into 3 short fragments spread across the
                        marker's full height - one right where the line enters from above,
                        one right where it resumes below, one in between - reads as
                        "compressed" rather than "faded", unlike a plain gap's unbroken
                        low-opacity line. */}
                    <div className="absolute inset-y-0 left-0 flex flex-col items-center justify-between py-0.5">
                      <span className="h-1 w-0 border-l-2 border-dust/50" />
                      <span className="h-1 w-0 border-l-2 border-dust/50" />
                      <span className="h-1 w-0 border-l-2 border-dust/50" />
                    </div>
                  </div>
                  <span className="sr-only">{formatSkippedDuration(entry.minutes)}</span>
                </div>
              );

            case "now":
              return (
                <div key={entry.key} className="relative z-10 flex gap-3 px-1" style={{ height: 0 }} aria-hidden="true">
                  <div className="-translate-y-1/2 w-16 shrink-0 text-right font-mono text-[10px] font-semibold text-alert">
                    {formatClockTime(entry.nowMs)}
                  </div>
                  <div className="relative -translate-y-1/2 flex-1">
                    <span className="absolute -left-[3px] top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-alert" />
                    <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-alert" />
                  </div>
                </div>
              );

            case "cluster": {
              const clusterHeightPx = Math.max(MIN_BLOCK_HEIGHT_PX, durationPx(entry.durationMinutes));

              // The overwhelmingly common case (no overlap) - rendered
              // exactly as a single block always was, not routed through
              // the percentage-of-cluster math a real overlap needs below.
              if (entry.blocks.length === 1) {
                const block = entry.blocks[0]!;
                const event = block.event;
                const unconfirmed = isUnconfirmed(event);
                const nowPercent =
                  block.nowOffsetMinutes !== undefined
                    ? Math.min(100, Math.max(0, (block.nowOffsetMinutes / Math.max(1, block.durationMinutes)) * 100))
                    : null;
                return (
                  <Link
                    key={entry.key}
                    to={eventHref(event)}
                    onMouseEnter={() => prefetchEvent(event.accountId, event.calendarId, event.id)}
                    onFocus={() => prefetchEvent(event.accountId, event.calendarId, event.id)}
                    className="group flex items-start gap-3 px-1"
                  >
                    <div className="w-16 shrink-0 pt-2 text-right font-mono text-[11px] leading-tight text-dust">
                      <div>{formatEventStartTime(event)}</div>
                      <div className="text-dust/60">{formatEventEndTime(event)}</div>
                    </div>
                    <div
                      className={`relative min-w-0 flex-1 border-l-2 px-3 py-2 group-hover:bg-accent/[0.12] ${
                        unconfirmed ? "border-dashed border-accent/50 bg-accent/[0.02]" : "border-accent bg-accent/[0.06]"
                      }`}
                      style={{ minHeight: clusterHeightPx }}
                    >
                      <div className={`font-display text-base leading-snug ${unconfirmed ? "text-ink/70" : "text-ink"}`}>
                        {event.title}
                      </div>
                      <div className="font-mono text-[11px] text-dust">{event.calendarSummary}</div>
                      {nowPercent !== null && (
                        <div
                          className="pointer-events-none absolute inset-x-0 h-px bg-alert"
                          style={{ top: `${nowPercent}%` }}
                          aria-hidden="true"
                        >
                          <span className="absolute -left-[5px] top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-alert" />
                        </div>
                      )}
                    </div>
                  </Link>
                );
              }

              // Genuine overlap: every block keeps the same full-width bar a
              // lone event gets (own top/height, own left-edge accent dash
              // still sitting right on the spine) rather than being
              // squeezed into a narrow column - only the *text* staggers
              // rightward per block.column, so overlapping titles don't sit
              // directly on top of each other. Two overlapping bars' own
              // translucent fills naturally stack into a visibly darker
              // band wherever they actually overlap in time - real
              // browser alpha compositing, not anything computed here.
              //
              // Each block's own top/height come from durationPx applied
              // independently to its offset and its duration (not as a
              // fraction of the cluster's already-compressed total) - a
              // short block deep inside a long cluster still gets the same
              // legible size a short block anywhere else would, rather than
              // shrinking further the later it falls (which is what sqrt's
              // shrinking marginal rate would do if the cluster's own
              // curve were applied cumulatively). The container then grows
              // to whichever is taller: the cluster's own compressed span,
              // or the bottom edge of its lowest block.
              const blockLayouts = entry.blocks.map((block) => ({
                block,
                top: durationPx(block.offsetMinutes),
                height: Math.max(MIN_BLOCK_HEIGHT_PX, durationPx(block.durationMinutes)),
              }));
              const containerHeightPx = Math.max(clusterHeightPx, ...blockLayouts.map((b) => b.top + b.height));

              return (
                <div key={entry.key} className="flex items-start gap-3 px-1">
                  <div className="w-16 shrink-0 pt-2 text-right font-mono text-[11px] leading-tight text-dust">
                    {formatClockTime(Math.min(...entry.blocks.map((b) => new Date(b.event.start).getTime())))}
                  </div>
                  <div className="relative min-w-0 flex-1" style={{ height: containerHeightPx }}>
                    {/* Paint layer: the full-width, alpha-blended bars described
                        above. Purely visual (pointer-events-none) - when two
                        blocks perfectly overlap, the higher-column bar would
                        otherwise sit on top at full width and swallow every
                        click meant for the one underneath it. */}
                    {blockLayouts.map(({ block, top, height }) => {
                      const event = block.event;
                      const textIndent = `calc(${(block.column / block.columnCount) * 100}% + 8px)`;
                      const nowPercent =
                        block.nowOffsetMinutes !== undefined
                          ? Math.min(100, Math.max(0, (block.nowOffsetMinutes / Math.max(1, block.durationMinutes)) * 100))
                          : null;
                      return (
                        <div
                          key={event.id}
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-x-0 overflow-hidden border-l-2 border-accent bg-accent/[0.08] py-1"
                          style={{ top, height, zIndex: block.column + 1 }}
                        >
                          <div
                            className="truncate font-display text-xs leading-snug text-ink"
                            style={{ paddingLeft: textIndent, paddingRight: 8 }}
                          >
                            {event.title}
                          </div>
                          {height > 30 && (
                            <div
                              className="truncate font-mono text-[10px] text-dust"
                              style={{ paddingLeft: textIndent, paddingRight: 8 }}
                            >
                              {formatEventStartTime(event)}
                            </div>
                          )}
                          {nowPercent !== null && (
                            <div
                              className="pointer-events-none absolute inset-x-0 h-px bg-alert"
                              style={{ top: `${nowPercent}%` }}
                              aria-hidden="true"
                            />
                          )}
                        </div>
                      );
                    })}
                    {/* Hit layer: one exclusive click/tap/focus slice per
                        column, always above the paint layer, so every
                        overlapping event - including two with identical
                        start/end - stays independently clickable regardless
                        of paint stacking order. */}
                    {blockLayouts.map(({ block, top, height }) => {
                      const event = block.event;
                      const leftPercent = (block.column / block.columnCount) * 100;
                      const widthPercent = 100 / block.columnCount;
                      return (
                        <Link
                          key={`${event.id}-hit`}
                          to={eventHref(event)}
                          onMouseEnter={() => prefetchEvent(event.accountId, event.calendarId, event.id)}
                          onFocus={() => prefetchEvent(event.accountId, event.calendarId, event.id)}
                          aria-label={`${event.title}, ${formatEventStartTime(event)}–${formatEventEndTime(event)}`}
                          className="absolute rounded-sm hover:bg-accent/20 focus-visible:bg-accent/20"
                          style={{ top, height, left: `${leftPercent}%`, width: `${widthPercent}%`, zIndex: 100 + block.column }}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            }
          }
        })}
    </section>
  );
}
