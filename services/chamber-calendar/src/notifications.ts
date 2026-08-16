import { createPushNotification } from "@congress/chamber-kit";
import { listEvents } from "./google/events.js";
import { eventUrl } from "./exhibits.js";
import { env } from "./env.js";

// Pushes into Capitol's own notification center rather than this Chamber
// inventing its own alert UI - see chamber-kit's createPushNotification for
// the upsert/withdraw contract this relies on.
const pushNotification = createPushNotification({
  chamber: "calendar",
  capitolUrl: env.CAPITOL_URL,
  internalToken: env.CONGRESS_INTERNAL_TOKEN,
});

// Only timed events within this window get a "starting soon" notification -
// an all-day event has no single meaningful "starting" moment, so it's
// skipped entirely rather than notifying at local midnight.
const LOOKAHEAD_MS = 30 * 60 * 1000;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

function dedupeKeyFor(accountId: number, calendarId: string, eventId: string): string {
  return `event-starting-soon-${accountId}:${encodeURIComponent(calendarId)}:${encodeURIComponent(eventId)}`;
}

// Unlike chamber-tasks' due-task check, this never explicitly withdraws -
// listEvents only looks forward from `now`, so an event simply stops
// appearing in the window once it starts, and its last-pushed "starting in
// 1 min" title is left for the owner to dismiss by hand rather than tracked
// across ticks for an explicit withdraw. Reasonable for a countdown-style
// reminder: the notification content itself trails off, it doesn't nag.
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
    await pushNotification({
      dedupeKey: dedupeKeyFor(event.accountId, event.calendarId, event.id),
      title: minutesUntil <= 1 ? `"${event.title}" is starting now` : `"${event.title}" starts in ${minutesUntil} min`,
      chamberUrl: eventUrl(event.accountId, event.calendarId, event.id),
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
