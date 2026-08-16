import type { NotificationPushRequest } from "@congress/shared-types";

// Same "best-effort, never blocks the caller" shape as createPushExhibitSync
// (exhibits.ts) - a Chamber calls the returned function to push into
// Capitol's own notification center (task due, event starting soon, ...)
// instead of building its own alert UI. Pass `withdraw: true` (with no
// `title`) once the underlying condition no longer holds, e.g. the task got
// completed or the event started - see notificationPushRequestSchema's own
// comment for the upsert/withdraw semantics.
export function createPushNotification(opts: { chamber: string; capitolUrl: string; internalToken: string }) {
  return async function pushNotification(push: Omit<NotificationPushRequest, "chamber">): Promise<void> {
    try {
      const res = await fetch(`${opts.capitolUrl}/capitol/notifications/push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Congress-Internal-Token": opts.internalToken,
        },
        body: JSON.stringify({ chamber: opts.chamber, ...push }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        console.warn(`Notification push rejected by Capitol: ${res.status}`);
      }
    } catch (err) {
      console.warn(`Notification push failed: ${(err as Error).message}`);
    }
  };
}
