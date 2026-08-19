import type { Manifest, ChamberSubscription } from "@congress/shared-types";

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export interface CapitolRegistrationOptions {
  manifest: Manifest;
  capitolUrl: string;
  internalToken: string;
  heartbeatIntervalMs: number;
  // This Chamber's current dynamic event interest list (see
  // shared-types/events.ts's chamberSubscriptionSchema) - read fresh on
  // every heartbeat (and the initial register call) rather than passed
  // once, since it changes at runtime as the Chamber's own rules/
  // automations/directives are edited. Omitted entirely by a Chamber that
  // never subscribes to anything.
  getSubscriptions?: () => ChamberSubscription[];
}

export function createCapitolRegistration(opts: CapitolRegistrationOptions) {
  const { manifest, capitolUrl, internalToken, heartbeatIntervalMs, getSubscriptions } = opts;

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
        const res = await fetch(`${capitolUrl}/congress/register`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ ...manifest, subscriptions: getSubscriptions?.() ?? [] }),
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

  // Exposed so a Chamber can call this out-of-band right after a rule/
  // automation/directive mutation, propagating a changed subscription list
  // to Congress near-instantly instead of waiting up to
  // heartbeatIntervalMs for the next scheduled beat. Best-effort like every
  // other call in this file - a failure here just means the regular
  // interval below repairs it on its own next tick.
  async function heartbeatNow(): Promise<void> {
    try {
      const res = await fetch(`${capitolUrl}/congress/heartbeat`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ name: manifest.name, subscriptions: getSubscriptions?.() ?? [] }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        console.warn(`Heartbeat rejected by Capitol: ${res.status}`);
      }
    } catch (err) {
      console.warn(`Heartbeat failed: ${(err as Error).message}`);
    }
  }

  function startHeartbeat(): void {
    heartbeatTimer = setInterval(() => void heartbeatNow(), heartbeatIntervalMs);
  }

  function stopHeartbeat(): void {
    stopped = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  }

  async function deregisterFromCapitol(): Promise<void> {
    try {
      await fetch(`${capitolUrl}/congress/deregister`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ name: manifest.name }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch (err) {
      console.warn(`Deregister failed: ${(err as Error).message}`);
    }
  }

  return { registerWithCapitolUntilSuccess, startHeartbeat, stopHeartbeat, heartbeatNow, deregisterFromCapitol };
}
