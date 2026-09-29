import { syncCalendarCache } from "./google/cache.js";
import { refreshUpcomingEventNotifications } from "./notifications.js";
import { getSettings } from "./settings.js";
import { createSyncScheduler } from "./syncScheduler.js";

// The Google cache sync loop, on the owner's interval (Settings → Calendar).
export const calendarSync = createSyncScheduler({
  sync: async () => {
    const failures = await syncCalendarCache();
    return failures.length ? failures.join("; ") : null;
  },
  intervalMs: async () => (await getSettings()).syncIntervalMinutes * 60_000,
  // Newly discovered events get their "starting soon" timers straight away.
  onSynced: refreshUpcomingEventNotifications,
});
