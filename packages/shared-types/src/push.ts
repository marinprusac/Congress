import { z } from "zod";

// Web Push subscription shape, straight off PushSubscription.toJSON() in the
// browser - owned by the notifications Chamber (the one place that stores
// subscriptions and calls sendWebPush), consumed by Capitol's subscribe UI
// and Congress's frontend service worker (the one SW every push targets,
// since it's the installed PWA shell).
export const pushSubscriptionRequestSchema = z.object({
  endpoint: z.string().min(1),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});
export type PushSubscriptionRequest = z.infer<typeof pushSubscriptionRequestSchema>;

export const pushUnsubscribeRequestSchema = z.object({
  endpoint: z.string().min(1),
});
export type PushUnsubscribeRequest = z.infer<typeof pushUnsubscribeRequestSchema>;

// null when Capitol has no VAPID keypair configured yet - the frontend uses
// this to hide the "Enable notifications" control entirely rather than
// offering a toggle that can never actually subscribe.
export const pushConfigResponseSchema = z.object({
  publicKey: z.string().nullable(),
});
export type PushConfigResponse = z.infer<typeof pushConfigResponseSchema>;
