import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCapitolSettings, capitolSettingsQueryKey, updateCapitolSettings, fetchRegistry } from "@congress/congress-ui";
import { fetchSettings, updateSettings } from "@/lib/api";
import { fetchPushConfig, getCurrentSubscription, subscribeToPush, unsubscribeFromPush } from "@/lib/push";

// Per-device, not a Congress-wide setting like dark mode above - each
// browser/device holds its own Web Push subscription, so "on" here means
// "this device", not "every device". See services/congress/frontend/src/sw.ts
// for the service worker this subscribes through and lib/push.ts for the
// subscribe/unsubscribe calls themselves.
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
    <div className="mt-6">
      <p className="font-mono text-xs uppercase tracking-wide text-dust">Push notifications</p>
      {status === "unconfigured" ? (
        <p className="mt-1 font-mono text-xs text-dust">
          Not set up on this server yet - Congress has no VAPID keypair configured.
        </p>
      ) : (
        <>
          <p className="mt-1 font-mono text-xs text-dust">
            Sends new notifications from Congress's own notification center to this device, even when Congress isn't
            open. Enable separately on each phone/laptop you use.
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

function WidgetVisibilitySection() {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ["capitol", "settings"], queryFn: fetchSettings });
  const { data: registry } = useQuery({ queryKey: ["congress", "registry"], queryFn: fetchRegistry });

  const mutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["capitol", "settings"] }),
  });

  if (!settings || !registry) return null;
  const hidden = new Set(settings.hiddenWidgets);
  // Capitol has no widget of its own - nothing to toggle for itself.
  const widgetChambers = registry.filter((chamber) => chamber.name !== "capitol");

  function toggle(name: string, visible: boolean) {
    const next = new Set(hidden);
    if (visible) next.delete(name);
    else next.add(name);
    mutation.mutate({ hiddenWidgets: [...next] });
  }

  return (
    <div className="mt-6">
      <p className="font-mono text-xs uppercase tracking-wide text-dust">Homepage widgets</p>
      <p className="mt-1 font-mono text-xs text-dust">Choose which Chambers show a widget on the Capitol homepage.</p>
      <div className="mt-3 flex flex-col gap-2">
        {widgetChambers.map((chamber) => (
          <label key={chamber.name} className="flex items-center gap-2 font-mono text-sm text-ink">
            <input
              type="checkbox"
              checked={!hidden.has(chamber.name)}
              onChange={(e) => toggle(chamber.name, e.target.checked)}
            />
            {chamber.displayName}
          </label>
        ))}
        {widgetChambers.length === 0 && <p className="font-mono text-xs text-dust">— No Chambers registered —</p>}
      </div>
    </div>
  );
}

function SignOutControl() {
  const queryClient = useQueryClient();

  async function handleSignOut() {
    await fetch("/auth/logout", { method: "POST" });
    queryClient.setQueryData(["auth", "status"], { authenticated: false });
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      className="font-mono text-xs uppercase tracking-wide text-dust hover:text-ink"
    >
      Sign out
    </button>
  );
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useCapitolSettings();

  const mutation = useMutation({
    mutationFn: updateCapitolSettings,
    onSuccess: (updated) => queryClient.setQueryData(capitolSettingsQueryKey(), updated),
  });

  return (
    <section>
      <h2 className="mb-6 font-display text-2xl text-ink">Settings</h2>

      {isLoading && <p className="font-mono text-sm text-dust">Loading —</p>}
      {isError && <p className="font-mono text-sm text-alert">Failed to load settings.</p>}

      {data && (
        <div>
          <label className="flex items-center gap-2 font-mono text-sm text-ink">
            <input
              type="checkbox"
              checked={data.darkMode}
              onChange={(e) => mutation.mutate({ darkMode: e.target.checked })}
            />
            Dark mode
          </label>
          <p className="mt-1 pl-6 font-mono text-xs text-dust">Applies across Congress and every Chamber, on any device.</p>
        </div>
      )}

      <WidgetVisibilitySection />

      <PushNotificationsSection />

      <div className="mt-10 border-t border-dust pt-6">
        <SignOutControl />
      </div>
    </section>
  );
}
