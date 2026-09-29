import { z } from "zod";

// A Google account connected through Congress's Google connector. Tokens
// never leave Congress; Chambers get access tokens through the host.
export const googleAccountSchema = z.object({
  id: z.number().int(),
  label: z.string(),
  email: z.string(),
  scopes: z.array(z.string()),
  needsReconnect: z.boolean(),
  connectedAt: z.string(),
});
export type GoogleAccount = z.infer<typeof googleAccountSchema>;

export const updateGoogleAccountRequestSchema = z.object({ label: z.string().min(1) });

const googleRequesterSchema = z.object({
  chamber: z.string(),
  displayName: z.string(),
  scopes: z.array(z.string()),
});

// Settings -> Accounts: every account, plus which Chambers still lack scopes on it.
export const googleConnectorStatusSchema = z.object({
  configured: z.boolean(),
  accounts: z.array(googleAccountSchema.extend({ missing: z.array(googleRequesterSchema) })),
  requesters: z.array(googleRequesterSchema),
});
export type GoogleConnectorStatus = z.infer<typeof googleConnectorStatusSchema>;
