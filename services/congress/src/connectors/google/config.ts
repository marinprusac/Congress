import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { env } from "../../env.js";

export interface GoogleClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export const CALLBACK_PATH = "/congress/connectors/google/callback";

type Source = Record<string, string | undefined>;

// Congress's own vars win; otherwise the Calendar Chamber's legacy ones, with
// the redirect moved to the connector's callback on the same origin.
export function resolveGoogleClientConfig(own: Source, fallback: Source): GoogleClientConfig | null {
  const pick = (key: string) => (own[key]?.trim() ? own[key]!.trim() : undefined);
  const clientId = pick("GOOGLE_OAUTH_CLIENT_ID") ?? fallback.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = pick("GOOGLE_OAUTH_CLIENT_SECRET") ?? fallback.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;

  let redirectUri = pick("GOOGLE_OAUTH_REDIRECT_URI");
  if (!redirectUri && fallback.GOOGLE_OAUTH_REDIRECT_URI) {
    try {
      redirectUri = new URL(CALLBACK_PATH, fallback.GOOGLE_OAUTH_REDIRECT_URI).toString();
    } catch {
      redirectUri = undefined;
    }
  }
  if (!redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

let cached: GoogleClientConfig | null | undefined;

export function googleClientConfig(): GoogleClientConfig | null {
  if (cached !== undefined) return cached;
  const fallbackPath = env.GOOGLE_OAUTH_FALLBACK_ENV_PATH;
  const fallback = existsSync(fallbackPath) ? parse(readFileSync(fallbackPath)) : {};
  cached = resolveGoogleClientConfig(
    {
      GOOGLE_OAUTH_CLIENT_ID: env.GOOGLE_OAUTH_CLIENT_ID,
      GOOGLE_OAUTH_CLIENT_SECRET: env.GOOGLE_OAUTH_CLIENT_SECRET,
      GOOGLE_OAUTH_REDIRECT_URI: env.GOOGLE_OAUTH_REDIRECT_URI,
    },
    fallback
  );
  return cached;
}

// Tests only.
export function setGoogleClientConfigForTests(config: GoogleClientConfig | null | undefined): void {
  cached = config;
}
