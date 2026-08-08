import { env } from "./env.js";
import { notesManifest } from "./manifest.js";

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Congress-Internal-Token": env.CONGRESS_INTERNAL_TOKEN,
  };
}

let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let stopped = false;

export async function registerWithCapitolUntilSuccess(): Promise<void> {
  let backoff = MIN_BACKOFF_MS;

  while (!stopped) {
    try {
      const res = await fetch(`${env.CAPITOL_URL}/capitol/register`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(notesManifest),
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) {
        console.log(`Registered with Capitol at ${env.CAPITOL_URL}`);
        return;
      }
      console.warn(`Capitol register returned ${res.status}, retrying in ${backoff}ms`);
    } catch (err) {
      console.warn(`Capitol unreachable (${(err as Error).message}), retrying in ${backoff}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, backoff));
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  }
}

export function startHeartbeat(): void {
  heartbeatTimer = setInterval(async () => {
    try {
      const res = await fetch(`${env.CAPITOL_URL}/capitol/heartbeat`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ name: notesManifest.name }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        console.warn(`Heartbeat rejected by Capitol: ${res.status}`);
      }
    } catch (err) {
      console.warn(`Heartbeat failed: ${(err as Error).message}`);
    }
  }, env.HEARTBEAT_INTERVAL_MS);
}

export function stopHeartbeat(): void {
  stopped = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
}

export async function deregisterFromCapitol(): Promise<void> {
  try {
    await fetch(`${env.CAPITOL_URL}/capitol/deregister`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: notesManifest.name }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    console.warn(`Deregister failed: ${(err as Error).message}`);
  }
}
