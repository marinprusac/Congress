const HEVY_BASE_URL = "https://api.hevyapp.com/v1";

export class HevyApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "HevyApiError";
  }
}

async function hevyFetch(apiKey: string, path: string, params: Record<string, string | number> = {}): Promise<unknown> {
  const url = new URL(`${HEVY_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

  const res = await fetch(url, { headers: { "api-key": apiKey, Accept: "application/json" } });
  if (!res.ok) {
    throw new HevyApiError(`Hevy API request failed: ${res.status} ${res.statusText}`, res.status);
  }
  return res.json();
}

export interface RawHevyEventsPage {
  events: unknown[];
  pageCount: number;
}

// Hevy's exact response envelope for this endpoint isn't fully pinned down
// by public docs at the time this was written (community sources agree on
// the page/pageSize/since query params and on "updated"/"deleted" event
// types, not on the wrapping object's exact key names) - tolerate a couple
// of plausible key names rather than assuming one, and confirm/simplify
// this against a real response once a Hevy Pro key is available.
export async function fetchWorkoutEventsPage(apiKey: string, since: string, page: number, pageSize = 10): Promise<RawHevyEventsPage> {
  const body = (await hevyFetch(apiKey, "/workouts/events", { since, page, pageSize })) as Record<string, unknown>;
  const events = (body.events ?? body.workout_events ?? []) as unknown[];
  const pageCount = Number(body.page_count ?? body.pageCount ?? 1);
  return { events, pageCount };
}

export async function fetchWorkout(apiKey: string, hevyId: string): Promise<unknown> {
  const body = (await hevyFetch(apiKey, `/workouts/${hevyId}`)) as Record<string, unknown>;
  return body.workout ?? body;
}
