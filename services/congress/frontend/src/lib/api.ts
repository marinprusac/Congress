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

// `keepalive` so the request survives the page reload that follows it right
// away (see main.tsx's controllerchange handler) - without it, a normal
// fetch racing a navigation can be aborted mid-flight before it reaches the
// server.
export async function notifyAppUpdated(): Promise<void> {
  await fetch("/congress/events/app-updated", { method: "POST", keepalive: true }).catch(() => {});
}
