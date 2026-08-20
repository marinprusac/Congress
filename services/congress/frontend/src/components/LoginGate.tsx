import { useState, type FormEvent, type ReactNode } from "react";
import { useIsRestoring, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchAuthStatus, login, logout } from "@/lib/api";

export function LoginGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["auth", "status"],
    queryFn: fetchAuthStatus,
  });
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // isRestoring covers the brief window before PersistedQueryProvider (see
  // main.tsx) finishes reading this query's last-known result back out of
  // IndexedDB - without waiting for it too, a cold/offline load would flash
  // the password form (no data yet) before the persisted "authenticated"
  // result has had a chance to land.
  const isRestoring = useIsRestoring();
  if (isRestoring || isLoading) {
    return null;
  }

  if (!data?.authenticated) {
    async function handleSubmit(e: FormEvent) {
      e.preventDefault();
      setSubmitting(true);
      setError(null);
      const result = await login(password);
      setSubmitting(false);
      if (result.ok) {
        setPassword("");
        queryClient.setQueryData(["auth", "status"], { authenticated: true });
      } else {
        setError(result.error);
      }
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-parchment text-ink">
        <form onSubmit={handleSubmit} className="w-full max-w-sm border-t border-dust px-6 py-8">
          <h1 className="mb-6 font-display text-3xl">Congress</h1>
          <label htmlFor="password" className="mb-2 block font-mono text-xs uppercase tracking-wide text-dust">
            Passphrase
          </label>
          <input
            id="password"
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mb-3 w-full border border-dust bg-parchment px-3 py-2 font-mono text-base text-ink focus:border-accent focus:outline-none"
          />
          {error && <p className="mb-3 font-mono text-xs text-alert">{error}</p>}
          <button
            type="submit"
            disabled={submitting || password.length === 0}
            className="w-full border border-ink bg-ink px-3 py-2 font-mono text-sm text-parchment disabled:opacity-50"
          >
            {submitting ? "Verifying —" : "Enter"}
          </button>
        </form>
      </div>
    );
  }

  return <>{children}</>;
}

export function SignOutControl() {
  const queryClient = useQueryClient();

  async function handleSignOut() {
    await logout();
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
