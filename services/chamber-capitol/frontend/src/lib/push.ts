import type { PushConfigResponse } from "@congress/shared-types";

// PushManager.subscribe wants the VAPID public key as a raw Uint8Array, not
// the base64url string Capitol hands out over /congress/push/config.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export async function fetchPushConfig(): Promise<PushConfigResponse> {
  const res = await fetch("/congress/push/config");
  if (!res.ok) return { publicKey: null };
  return res.json();
}

// null covers both "never subscribed" and "this browser doesn't support
// Web Push at all" - the caller doesn't need to tell those apart, both
// render as an offered-but-unchecked "Enable" control.
export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function subscribeToPush(publicKey: string): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted");
  }
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    // Uint8Array<ArrayBufferLike> vs. PushManager's ArrayBuffer-backed
    // BufferSource type is a nominal-only mismatch in newer DOM lib
    // typings - structurally identical at runtime.
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
  });
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error("Browser returned an incomplete push subscription");
  }
  await fetch("/congress/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }),
  });
}

export async function unsubscribeFromPush(): Promise<void> {
  const subscription = await getCurrentSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await fetch("/congress/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
}
