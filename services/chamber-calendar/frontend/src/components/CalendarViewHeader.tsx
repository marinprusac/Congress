import type { CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { resolveChamberPath, useShellHosted, StackLink } from "@congress/congress-ui";
import { fetchEvent } from "@/lib/api";
import type { AccountError, CalendarEvent } from "../../../src/types";

type CalendarView = "timeline" | "week";

const VIEWS: { id: CalendarView; label: string; path: string }[] = [
  { id: "timeline", label: "Timeline", path: "/" },
  { id: "week", label: "Week", path: "/week" },
];

// The top of both Calendar views: a Timeline/Week switch, plus a notice per
// Google account that needs reconnecting (in Congress's Settings).
export function CalendarViewHeader({ active, accountErrors }: { active: CalendarView; accountErrors: AccountError[] }) {
  const shellHosted = useShellHosted();

  return (
    <>
      <div className="mb-4 flex gap-4 font-mono text-xs uppercase tracking-wide" role="tablist">
        {VIEWS.map((view) => (
          <StackLink
            key={view.id}
            to={resolveChamberPath(view.path, "calendar", shellHosted)}
            replace
            role="tab"
            aria-selected={view.id === active}
            className={view.id === active ? "border-b-2 border-accent pb-1 text-ink" : "pb-1 text-dust hover:text-ink"}
          >
            {view.label}
          </StackLink>
        ))}
      </div>
      {accountErrors.map((err) => (
        <div key={err.accountId} className="mb-4 border border-alert px-3 py-2 font-mono text-sm text-alert">
          "{err.label}" needs to be reconnected —{" "}
          {shellHosted ? (
            <StackLink to="/settings?from=calendar" className="underline">
              reconnect in Settings
            </StackLink>
          ) : (
            <a href="/settings?from=calendar" className="underline">
              reconnect in Settings
            </a>
          )}
        </div>
      ))}
    </>
  );
}

// Where an event opens (its editor), and a prefetch for hover/focus - the
// query key matches EventEditorPage's own exactly (String(accountId)), or
// the prefetch would land in a cache entry nothing reads.
export function useEventLinks() {
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();
  return {
    href: (event: CalendarEvent) =>
      resolveChamberPath(
        `/e/${event.accountId}/${encodeURIComponent(event.calendarId)}/${encodeURIComponent(event.id)}`,
        "calendar",
        shellHosted
      ),
    prefetch: (event: CalendarEvent) =>
      queryClient.prefetchQuery({
        queryKey: ["events", String(event.accountId), event.calendarId, event.id],
        queryFn: () => fetchEvent(event.accountId, event.calendarId, event.id),
      }),
  };
}

// An event's own calendar color, falling back to the accent.
export function eventColor(event: CalendarEvent): string {
  return event.calendarColor ?? "var(--color-accent)";
}

// A block/chip filled with a light wash of the event's color and a solid
// (or, for a tentative event, dashed) left edge.
export function eventSwatchStyle(event: CalendarEvent, tentative: boolean): CSSProperties {
  const color = eventColor(event);
  return {
    borderLeft: `2px ${tentative ? "dashed" : "solid"} ${color}`,
    backgroundColor: `color-mix(in srgb, ${color} ${tentative ? 8 : 20}%, var(--color-parchment))`,
  };
}
