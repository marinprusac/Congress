// Congress's Google connector (Settings -> Accounts) - shared by every Chamber that talks to Google.
export const GOOGLE_ACCOUNTS_SETTINGS_PATH = "/settings?from=accounts";

// Full-page link that (re)connects a Google account with every Chamber's scopes, then returns.
export function googleConnectHref(opts: { returnTo?: string; loginHint?: string } = {}): string {
  const params = new URLSearchParams({ returnTo: opts.returnTo ?? GOOGLE_ACCOUNTS_SETTINGS_PATH });
  if (opts.loginHint) params.set("loginHint", opts.loginHint);
  return `/congress/connectors/google/start?${params.toString()}`;
}
