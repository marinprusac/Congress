import webpush from "web-push";
import { eq } from "drizzle-orm";
import type { PushSubscriptionRequest } from "@congress/shared-types";
import { db } from "./db/client.js";
import { pushSubscriptions } from "./db/schema.js";
import { env } from "./env.js";

const vapidConfigured = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
if (vapidConfigured) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
} else {
  console.warn(
    "VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set - Web Push notifications are disabled (the in-app notification center still works)."
  );
}

export function publicKey(): string | null {
  return vapidConfigured ? env.VAPID_PUBLIC_KEY! : null;
}

export function saveSubscription(sub: PushSubscriptionRequest): void {
  const existing = db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, sub.endpoint)).get();
  if (existing) {
    db.update(pushSubscriptions)
      .set({ p256dh: sub.keys.p256dh, auth: sub.keys.auth })
      .where(eq(pushSubscriptions.id, existing.id))
      .run();
  } else {
    db.insert(pushSubscriptions)
      .values({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, createdAt: new Date() })
      .run();
  }
}

export function removeSubscription(endpoint: string): void {
  db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).run();
}

interface PushPayload {
  title: string;
  body: string | null;
  chamber: string;
  chamberUrl: string | null;
}

// Fans a notification out to every subscribed device (phone, laptop, ...) -
// best-effort: a delivery failure here must never surface as an error to
// whatever triggered the notification that led here. A 404/410 means the
// browser itself discarded that subscription (uninstalled, permission
// revoked, endpoint rotated) - the one case worth acting on, by pruning the
// row so it stops being retried forever.
export async function sendWebPush(payload: PushPayload): Promise<void> {
  if (!vapidConfigured) return;

  const subscriptions = db.select().from(pushSubscriptions).all();
  const body = JSON.stringify(payload);

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          removeSubscription(sub.endpoint);
        } else {
          console.warn(`Web Push delivery failed for one subscription: ${(err as Error).message}`);
        }
      }
    })
  );
}
