import { chamberEnvSchema, loadEnv } from "@congress/chamber-kit";
import { z } from "zod";

export const env = loadEnv(
  chamberEnvSchema.extend({
    PORT: z.coerce.number().int().positive().default(8016),
    DB_PATH: z.string().default("./data/notifications.sqlite3"),
    // Optional, unlike every other secret this Chamber needs - Web Push is
    // additive (the in-app notification center works fine without it), and
    // an unset/missing keypair must never crash the whole service on boot.
    // sendWebPush no-ops (with a one-time warning) when either is absent;
    // GET /api/push/config reports publicKey: null so the frontend can hide
    // the "Enable notifications" control instead of offering a toggle that
    // can't work.
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().default("mailto:congress@example.com"),
  })
);
