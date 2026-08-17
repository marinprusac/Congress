import { createPublishEvent } from "@congress/chamber-kit";
import { listEvents } from "./google/events.js";
import { eventUrl } from "./exhibits.js";
import { env } from "./env.js";

// Publishes to Congress's generic event log rather than pushing a
// notification directly - this Chamber only knows an event is starting
// soon, not whether anything should happen about it or what that should
// say; the notifications Chamber's own automations decide that. See
// chamber-kit's createPublishEvent and this Chamber's manifest.ts for the
// event catalog.
const publishEvent = createPublishEvent({
  chamber: "calendar",
  capitolUrl: env.CAPITOL_URL,
  internalToken: env.CONGRESS_INTERNAL_TOKEN,
});

// Only timed events within this window get a "starting soon" event - an
// all-day event has no single meaningful "starting" moment, so it's skipped
// entirely rather than firing at local midnight.
const LOOKAHEAD_MS = 30 * 60 * 1000;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

function dedupeKeyFor(accountId: number, calendarId: string, eventId: string): string {
  return `event-starting-soon-${accountId}:${encodeURIComponent(calendarId)}:${encodeURIComponent(eventId)}`;
}

// Unlike chamber-tasks' due-task check, this never publishes a "cleared"
// counterpart - listEvents only looks forward from `now`, so an event
// simply stops appearing in the window once it starts, and whatever
// automation matched this is left for the owner to dismiss by hand rather
// than tracked across ticks for an explicit withdraw. Reasonable for a
// countdown-style reminder: the notification content itself trails off, it
// doesn't nag.
async function checkUpcomingEvents(): Promise<void> {
  const now = Date.now();
  let events;
  try {
    ({ events } = await listEvents(new Date(now).toISOString(), new Date(now + LOOKAHEAD_MS).toISOString()));
  } catch (err) {
    console.warn(`Upcoming-event check failed: ${(err as Error).message}`);
    return;
  }

  for (const event of events) {
    if (event.allDay) continue;
    const startMs = new Date(event.start).getTime();
    const minutesUntil = Math.max(0, Math.round((startMs - now) / 60_000));
    await publishEvent({
      type: "calendar.event_starting_soon",
      payload: {
        dedupeKey: dedupeKeyFor(event.accountId, event.calendarId, event.id),
        title: event.title,
        minutesUntil,
        url: eventUrl(event.accountId, event.calendarId, event.id),
      },
    });
  }
}

let interval: ReturnType<typeof setInterval> | undefined;

export function startUpcomingEventNotifications(): void {
  void checkUpcomingEvents();
  interval = setInterval(() => void checkUpcomingEvents(), CHECK_INTERVAL_MS);
}

export function stopUpcomingEventNotifications(): void {
  if (interval) clearInterval(interval);
}
