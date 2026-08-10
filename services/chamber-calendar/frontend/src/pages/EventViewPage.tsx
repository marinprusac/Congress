import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ExhibitAnnotatedText,
  ExhibitSharingBadge,
  ExhibitLinksLayout,
  ShareControl,
  navigateToExhibit,
} from "@congress/exhibit-ui";
import { fetchEvent } from "@/lib/api";
import { formatEventFullRange } from "@/lib/datetime";
import { toExhibitId } from "@/lib/exhibits";
import { getChamberIcon } from "@/components/ChamberIcon";

export function EventViewPage() {
  const { accountId, calendarId, eventId } = useParams<{
    accountId: string;
    calendarId: string;
    eventId: string;
  }>();
  const navigate = useNavigate();

  const { data: event, isLoading, isError } = useQuery({
    queryKey: ["events", accountId, calendarId, eventId],
    queryFn: () => fetchEvent(Number(accountId), calendarId!, eventId!),
    enabled: Boolean(accountId && calendarId && eventId),
  });

  const exhibitId =
    accountId && calendarId && eventId ? toExhibitId(Number(accountId), calendarId, eventId) : null;

  if (isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (isError || !event) return <p className="font-mono text-sm text-alert">Failed to load this event.</p>;
  if (!exhibitId) return <p className="font-mono text-sm text-alert">Invalid event id.</p>;

  return (
    <section>
      <div className="mb-6 flex flex-col gap-3 border-b border-dust pb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <h2 className="flex min-w-0 items-center gap-3 font-display text-3xl text-ink">
          {event.title}
          <ExhibitSharingBadge exhibitId={exhibitId} className="exhibit-sharing-badge" />
        </h2>
        <div className="flex shrink-0 items-center gap-5 font-mono text-xs uppercase tracking-wide">
          <ShareControl chamber="calendar" exhibitId={exhibitId} exhibitName={event.title} />
          <Link
            to={`/e/${event.accountId}/${encodeURIComponent(event.calendarId)}/${encodeURIComponent(event.id)}/edit`}
            className="tap-target text-accent hover:underline"
          >
            Edit
          </Link>
        </div>
      </div>

      <ExhibitLinksLayout
        exhibitId={exhibitId}
        emptyBacklinksLabel="Nothing references this event"
        emptyFrontlinksLabel="This event references nothing"
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("calendar", r, navigate)}
      >
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
              <dd className="text-ink">
                <ExhibitAnnotatedText
                  text={event.description}
                  renderIcon={(chamber) => getChamberIcon(chamber)}
                  onNavigate={(r) => navigateToExhibit("calendar", r, navigate)}
                  className="whitespace-pre-wrap"
                />
              </dd>
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
      </ExhibitLinksLayout>
    </section>
  );
}
