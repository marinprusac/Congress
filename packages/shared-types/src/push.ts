import { z } from "zod";

// Web Push subscription shape, straight off PushSubscription.toJSON() in the
// browser - a Chamber never sees this (it stays entirely within Capitol,
// which owns the one service worker every push targets), so it lives
// alongside the notification schemas rather than exported for Chambers.
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
