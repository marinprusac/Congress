import { ensureFreshAccessToken, type AccountRow } from "./accounts.js";

export class GoogleApiError extends Error {
  status: number;
  constructor(status: number, body: string) {
    super(`Google Calendar API error: ${status} ${body}`);
    this.name = "GoogleApiError";
    this.status = status;
  }
}

export async function googleCalendarFetch(
  account: AccountRow,
  path: string,
  init?: RequestInit
): Promise<unknown> {
  const accessToken = await ensureFreshAccessToken(account);
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    throw new GoogleApiError(res.status, await res.text());
  }
  if (res.status === 204) return undefined;
  return res.json();
}
