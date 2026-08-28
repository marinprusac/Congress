import { createPublishEvent } from "@congress/chamber-kit";
import { listCachedEvents } from "./google/cache.js";
import { eventUrl } from "./google/eventId.js";
import { env } from "./env.js";

// Publishes to Congress's push relay rather than pushing a notification
// directly - this Chamber only knows an event is starting soon, not
// whether anything should happen about it or what that should say; the
// notifications Chamber's own rules decide that. See chamber-kit's
// createPublishEvent and this Chamber's manifest.ts for the event catalog.
const publishEvent = createPublishEvent({
  chamber: "calendar",
  capitolUrl: env.CAPITOL_URL,
  internalToken: env.CONGRESS_INTERNAL_TOKEN,
});

// Only timed events within this window get a "starting soon" event - an
// all-day event has no single meaningful "starting" moment, so it's skipped
// entirely rather than firing at local midnight.
const LOOKAHEAD_MS = 30 * 60 * 1000;

// How often this Chamber re-polls Google Calendar to discover events at
// all - still needed regardless of the precise per-event timers below,
// since Google is an external data source this Chamber doesn't control and
// has no push subscription to (no webhook in scope - see
// docs/creating-a-chamber.md's Events section). This bounds *discovery*
// latency; the timers below make *firing* exact once an event's been seen.
const POLL_INTERVAL_MS = 5 * 60 * 1000;

function dedupeKeyFor(accountId: number, calendarId: string, eventId: string): string {
  return `event-starting-soon-${accountId}:${encodeURIComponent(calendarId)}:${encodeURIComponent(eventId)}`;
}

interface ScheduledFire {
  // Undefined once fired - kept as a map entry (rather than removed) so a
  // later poll that still sees this same event/start time knows it's
  // already been handled, instead of re-arming a zero-delay timer and
  // publishing a duplicate on every subsequent poll until the event's start
  // time finally passes.
  timer: ReturnType<typeof setTimeout> | undefined;
  // The instant this was armed for - lets a later poll tell "still the same
  // start time, leave it alone" apart from "rescheduled, replace it".
  fireAtMs: number;
}

// One entry per (accountId, calendarId, eventId) currently within the
// lookahead window - in-memory only, rebuilt from Google's own data on
// every poll, so a restart just loses precise timing until the next poll
// re-discovers what's upcoming (same accepted gap chamber-tasks' own
// lastNotifiedState has). Entries for events no longer in the polled
// window are pruned at the end of each pollUpcomingEvents run.
const scheduled = new Map<string, ScheduledFire>();

// Unlike chamber-tasks' due-task check, this never publishes a "cleared"
// counterpart - once an event's start passes, listEvents (which only looks
// forward from `now`) simply stops returning it, so it naturally drops out
// of `scheduled` without an explicit withdraw. Reasonable for a
// countdown-style reminder: the notification content itself trails off, it
// doesn't nag.
async function publishStartingSoon(accountId: number, calendarId: string, eventId: string, title: string, startMs: number): Promise<void> {
  const minutesUntil = Math.max(0, Math.round((startMs - Date.now()) / 60_000));
  await publishEvent({
    type: "calendar.event_starting_soon",
    payload: {
      dedupeKey: dedupeKeyFor(accountId, calendarId, eventId),
      title,
      minutesUntil,
      url: eventUrl(accountId, calendarId, eventId),
      priority: "high",
    },
  });
}

// Re-syncs this event's own precise fire time against what a poll just
// observed - arms a new setTimeout for exactly `start - LOOKAHEAD_MS`
// (or fires immediately if that instant has already passed), replacing any
// previously-armed timer for the same event if its start time moved, and
// leaving an unchanged one alone.
function scheduleFire(key: string, fireAtMs: number, fire: () => void): void {
  const existing = scheduled.get(key);
  // Same fire instant as before, whether it's still pending or has already
  // fired - either way there's nothing new to do here.
  if (existing && existing.fireAtMs === fireAtMs) return;
  if (existing?.timer) clearTimeout(existing.timer);

  const delay = Math.max(0, fireAtMs - Date.now());
  const entry: ScheduledFire = { timer: undefined, fireAtMs };
  entry.timer = setTimeout(() => {
    entry.timer = undefined;
    fire();
  }, delay);
  scheduled.set(key, entry);
}

// A local cache read now, not a live Google call - the calendar cache sync
// (google/cache.ts) is what actually talks to Google on its own interval;
// this just re-arms timers off whatever it last synced.
function pollUpcomingEvents(): void {
  const now = Date.now();
  const events = listCachedEvents(new Date(now).toISOString(), new Date(now + LOOKAHEAD_MS).toISOString());
  const seen = new Set<string>();

  for (const event of events) {
    if (event.allDay) continue;
    const key = dedupeKeyFor(event.accountId, event.calendarId, event.id);
    seen.add(key);
    const startMs = new Date(event.start).getTime();
    scheduleFire(key, startMs - LOOKAHEAD_MS, () => {
      void publishStartingSoon(event.accountId, event.calendarId, event.id, event.title, startMs).catch((err) =>
        console.warn(`calendar.event_starting_soon publish failed: ${(err as Error).message}`)
      );
    });
  }

  // Drop anything that fell out of the polled window - cancelled, moved
  // outside the lookahead, or (the common case) its start time simply
  // passed - so a restarted event id occurring later isn't mistaken for
  // "already handled", and so this map doesn't grow without bound.
  for (const key of scheduled.keys()) {
    if (!seen.has(key)) scheduled.delete(key);
  }
}

let pollInterval: ReturnType<typeof setInterval> | undefined;

export function startUpcomingEventNotifications(): void {
  pollUpcomingEvents();
  pollInterval = setInterval(pollUpcomingEvents, POLL_INTERVAL_MS);
}

export function stopUpcomingEventNotifications(): void {
  if (pollInterval) clearInterval(pollInterval);
  for (const { timer } of scheduled.values()) clearTimeout(timer);
  scheduled.clear();
}
