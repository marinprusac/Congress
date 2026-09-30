import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { RecordDto } from "@congress/shared-types";
import { toCalendarItems } from "./calendarViews";

// Event records in a window, plus calendar colors and account problems from
// the Google Calendar connector (both optional: views work without it).

interface ConnectorStatus {
  accounts: { id: number; label: string; lastError: string | null; calendars: { id: string; color: string | null }[] }[];
}

async function fetchWindow(from: string, to: string): Promise<RecordDto[]> {
  const res = await fetch(`/congress/records?type=event&limit=500&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  if (!res.ok) throw new Error(`Events failed (${res.status})`);
  return res.json() as Promise<RecordDto[]>;
}

async function fetchStatus(): Promise<ConnectorStatus | null> {
  const res = await fetch("/congress/connectors/google-calendar/status");
  return res.ok ? (res.json() as Promise<ConnectorStatus>) : null;
}

export function useCalendarWindow(from: Date, to: Date) {
  const events = useQuery({
    queryKey: ["events-view", from.toISOString(), to.toISOString()],
    queryFn: () => fetchWindow(from.toISOString(), to.toISOString()),
    placeholderData: keepPreviousData,
  });
  const status = useQuery({ queryKey: ["connectors", "google-calendar", "status"], queryFn: fetchStatus, staleTime: 60_000 });
  const colors = new Map<string, string | null>();
  for (const a of status.data?.accounts ?? []) for (const c of a.calendars) colors.set(`${a.id}:${c.id}`, c.color);
  const problems = (status.data?.accounts ?? []).filter((a) => a.lastError).map((a) => ({ id: a.id, label: a.label, error: a.lastError! }));
  return {
    items: events.data ? toCalendarItems(events.data, colors) : [],
    isLoading: events.isLoading,
    isError: events.isError,
    problems,
  };
}
