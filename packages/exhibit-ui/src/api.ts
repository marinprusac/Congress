// In production a Chamber's frontend is proxied through Capitol at
// "/<chamber>/*", but its API calls still need to reach Capitol's gateway at
// "/api/<chamber>/*" (Capitol forwards "/api/<chamber>/<rest>" to that
// Chamber's own "/api/<rest>"). In dev, Vite proxies "/api" straight to that
// Chamber's own server, so no "/<chamber>" segment is needed there. `isProd`
// is passed in rather than read from import.meta.env here, since exhibit-ui
// isn't built with vite/client types.
export function resolveApiBase(chamberName: string, isProd: boolean): string {
  return isProd ? `/api/${chamberName}` : "/api";
}

export async function parseJsonResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.message ?? body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export function assertDeleteOk(res: Response, actionLabel: string): void {
  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to ${actionLabel}: ${res.status}`);
  }
}
