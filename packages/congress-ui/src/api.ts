// A Chamber's API always goes through Congress's gateway, "/api/<chamber>/*",
// dev and production alike - Chambers have no server of their own.
export function resolveApiBase(chamberName: string): string {
  return `/api/${chamberName}`;
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
