export async function fetchAuthStatus(): Promise<{ authenticated: boolean }> {
  const res = await fetch("/auth/status");
  if (!res.ok) return { authenticated: false };
  return res.json();
}

export async function login(password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (res.ok) return { ok: true };
  if (res.status === 429) return { ok: false, error: "Too many attempts. Try again later." };
  return { ok: false, error: "Incorrect passphrase." };
}

export async function logout(): Promise<void> {
  await fetch("/auth/logout", { method: "POST" });
}

const APP_UPDATED_TIMEOUT_MS = 1500;

// `keepalive` is meant to let a fetch survive the page reload that follows
// it right away (see main.tsx's controllerchange handler), but WebKit's
// support for that has a long history of not actually surviving a
// same-tick navigation - the exact browser this fires in on an installed
// iOS PWA. So main.tsx awaits this (bounded by a short timeout, not left
// to hang if the network is briefly unreachable mid-deploy) before
// reloading, rather than relying on keepalive alone to win the race.
export async function notifyAppUpdated(): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), APP_UPDATED_TIMEOUT_MS);
  await fetch("/congress/events/app-updated", { method: "POST", keepalive: true, signal: controller.signal })
    .catch(() => {})
    .finally(() => clearTimeout(timeout));
}
