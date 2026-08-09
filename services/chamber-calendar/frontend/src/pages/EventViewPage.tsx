import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchEvent } from "@/lib/api";
import { formatEventFullRange } from "@/lib/datetime";

export function EventViewPage() {
  const { accountId, calendarId, eventId } = useParams<{
    accountId: string;
    calendarId: string;
    eventId: string;
  }>();

  const { data: event, isLoading, isError } = useQuery({
    queryKey: ["events", accountId, calendarId, eventId],
    queryFn: () => fetchEvent(Number(accountId), calendarId!, eventId!),
    enabled: Boolean(accountId && calendarId && eventId),
  });

  if (isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (isError || !event) return <p className="font-mono text-sm text-alert">Failed to load this event.</p>;

  return (
    <section>
      <div className="mb-6 flex items-start justify-between gap-4 border-b border-dust pb-4">
        <h2 className="min-w-0 font-display text-3xl text-ink">{event.title}</h2>
        <Link
          to={`/e/${event.accountId}/${encodeURIComponent(event.calendarId)}/${encodeURIComponent(event.id)}/edit`}
          className="shrink-0 font-mono text-xs uppercase tracking-wide text-accent hover:underline"
        >
          Edit
        </Link>
      </div>

      <dl className="space-y-4 font-mono text-sm">
        <div>
          <dt className="mb-1 text-xs uppercase tracking-wide text-dust">When</dt>
          <dd className="text-ink">{formatEventFullRange(event)}</dd>
        </div>
        {event.location && (
          <div>
            <dt className="mb-1 text-xs uppercase tracking-wide text-dust">Location</dt>
            <dd className="text-ink">{event.location}</dd>
          </div>
        )}
        <div>
          <dt className="mb-1 text-xs uppercase tracking-wide text-dust">Calendar</dt>
          <dd className="text-ink">{event.calendarSummary}</dd>
        </div>
        {event.description && (
          <div>
            <dt className="mb-1 text-xs uppercase tracking-wide text-dust">Description</dt>
            <dd className="whitespace-pre-wrap text-ink">{event.description}</dd>
          </div>
        )}
      </dl>

      {event.htmlLink && (
        <a
          href={event.htmlLink}
          target="_blank"
          rel="noreferrer"
          className="mt-8 inline-block font-mono text-xs uppercase tracking-wide text-slate hover:text-accent"
        >
          Open in Google Calendar ↗
        </a>
      )}
    </section>
  );
}
