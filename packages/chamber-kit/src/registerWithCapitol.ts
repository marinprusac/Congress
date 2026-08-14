import type { Manifest } from "@congress/shared-types";

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export interface CapitolRegistrationOptions {
  manifest: Manifest;
  capitolUrl: string;
  internalToken: string;
  heartbeatIntervalMs: number;
}

export function createCapitolRegistration(opts: CapitolRegistrationOptions) {
  const { manifest, capitolUrl, internalToken, heartbeatIntervalMs } = opts;

  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;

  function authHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "X-Congress-Internal-Token": internalToken,
    };
  }

  async function registerWithCapitolUntilSuccess(): Promise<void> {
    let backoff = MIN_BACKOFF_MS;

    while (!stopped) {
      try {
        const res = await fetch(`${capitolUrl}/capitol/register`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify(manifest),
          signal: AbortSignal.timeout(5_000),
        });
        if (res.ok) {
          console.log(`Registered with Capitol at ${capitolUrl}`);
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

  function startHeartbeat(): void {
    heartbeatTimer = setInterval(async () => {
      try {
        const res = await fetch(`${capitolUrl}/capitol/heartbeat`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ name: manifest.name }),
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) {
          console.warn(`Heartbeat rejected by Capitol: ${res.status}`);
        }
      } catch (err) {
        console.warn(`Heartbeat failed: ${(err as Error).message}`);
      }
    }, heartbeatIntervalMs);
  }

  function stopHeartbeat(): void {
    stopped = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  }

  async function deregisterFromCapitol(): Promise<void> {
    try {
      await fetch(`${capitolUrl}/capitol/deregister`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ name: manifest.name }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch (err) {
      console.warn(`Deregister failed: ${(err as Error).message}`);
    }
  }

  return { registerWithCapitolUntilSuccess, startHeartbeat, stopHeartbeat, deregisterFromCapitol };
}
