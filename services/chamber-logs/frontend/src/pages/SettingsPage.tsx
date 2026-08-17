import { useEffect, useState } from "react";
import { PageHeader } from "@congress/congress-ui";
import { fetchPushConfig, getCurrentSubscription, subscribeToPush, unsubscribeFromPush } from "@/lib/push";

// Per-device, not a Chamber-wide setting - each browser/device holds its own
// Web Push subscription, so "on" here means "this device", not "every
// device". See services/congress/frontend/src/sw.ts for the service worker
// this subscribes through (the one PWA shell every push targets) and
// lib/push.ts for the subscribe/unsubscribe calls themselves.
function PushNotificationsSection() {
  const [status, setStatus] = useState<"loading" | "unsupported" | "unconfigured" | "off" | "on">("loading");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setStatus("unsupported");
        return;
      }
      const config = await fetchPushConfig();
      setPublicKey(config.publicKey);
      if (!config.publicKey) {
        setStatus("unconfigured");
        return;
      }
      const subscription = await getCurrentSubscription();
      setStatus(subscription ? "on" : "off");
    })();
  }, []);

  async function enable() {
    if (!publicKey) return;
    setBusy(true);
    setError(null);
    try {
      await subscribeToPush(publicKey);
      setStatus("on");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      await unsubscribeFromPush();
      setStatus("off");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading" || status === "unsupported") return null;

  return (
    <div>
      <p className="font-mono text-xs uppercase tracking-wide text-dust">Push notifications</p>
      {status === "unconfigured" ? (
        <p className="mt-1 font-mono text-xs text-dust">
          Not set up on this server yet - this Chamber has no VAPID keypair configured.
        </p>
      ) : (
        <>
          <p className="mt-1 font-mono text-xs text-dust">
            Sends new notifications to this device, even when Congress isn't open. Enable separately on each
            phone/laptop you use.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={status === "on" ? disable : enable}
            className="mt-3 border border-dust px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-ink hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {status === "on" ? "Disable on this device" : "Enable on this device"}
          </button>
          {error && <p className="mt-2 font-mono text-xs text-alert">{error}</p>}
        </>
      )}
    </div>
  );
}

export function SettingsPage() {
  return (
    <section>
      <PageHeader title="Settings" />
      <PushNotificationsSection />
    </section>
  );
}
