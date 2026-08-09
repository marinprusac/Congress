import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { CapitolExhibitResolveResult } from "@congress/shared-types";
import { ExhibitAnnotatedText, ExhibitChip, ExhibitSharingBadge, navigateToExhibit } from "@congress/exhibit-ui";
import { fetchEvent } from "@/lib/api";
import { formatEventFullRange } from "@/lib/datetime";
import { toExhibitId } from "@/lib/exhibits";
import { getChamberIcon } from "@/components/ChamberIcon";

async function fetchBacklinks(exhibitId: string): Promise<CapitolExhibitResolveResult[]> {
  const res = await fetch(`/capitol/exhibits/${exhibitId}/backlinks`);
  if (!res.ok) return [];
  const data = (await res.json()) as { backlinks: CapitolExhibitResolveResult[] };
  return data.backlinks;
}

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
  const backlinksQuery = useQuery({
    queryKey: ["exhibit-backlinks", exhibitId],
    queryFn: () => fetchBacklinks(exhibitId!),
    enabled: exhibitId !== null,
  });

  if (isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (isError || !event) return <p className="font-mono text-sm text-alert">Failed to load this event.</p>;

  return (
    <section>
      <div className="mb-6 flex items-start justify-between gap-4 border-b border-dust pb-4">
        <h2 className="flex min-w-0 items-center gap-3 font-display text-3xl text-ink">
          {event.title}
          {exhibitId && <ExhibitSharingBadge exhibitId={exhibitId} className="exhibit-sharing-badge" />}
        </h2>
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

      <section className="mt-10 border-t border-dust pt-4">
        <h3 className="mb-2 font-mono text-xs uppercase tracking-wide text-dust">
          Referenced by ({backlinksQuery.data?.length ?? 0})
        </h3>
        {(backlinksQuery.data?.length ?? 0) === 0 ? (
          <p className="font-mono text-sm text-dust">— Nothing references this event —</p>
        ) : (
          <ul>
            {backlinksQuery.data?.map((b) => (
              <li key={`${b.chamber}:${b.id}`} className="border-b border-dust py-2">
                <ExhibitChip
                  result={b}
                  renderIcon={(chamber) => getChamberIcon(chamber)}
                  onNavigate={(r) => navigateToExhibit("calendar", r, navigate)}
                  className="exhibit-chip font-mono text-sm"
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
