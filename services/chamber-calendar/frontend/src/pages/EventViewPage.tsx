import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ExhibitActionBar,
  ExhibitLinksLayout,
  navigateToExhibit,
  getChamberIcon,
  useShellHosted,
  resolveChamberPath,
  useAutosave,
} from "@congress/congress-ui";
import { EventForm, type EventFormValues } from "@/components/EventForm";
import { fetchEvent, updateEvent, deleteEvent, setEventAttendance } from "@/lib/api";
import { getBrowserTimeZone, toDatetimeLocalInput } from "@/lib/datetime";
import { toExhibitId } from "@/lib/exhibits";
import type { AttendanceStatus, CalendarEvent } from "../../../src/types";

const RESPONSE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  needsAction: "Awaiting your response",
  accepted: "You accepted",
  declined: "You declined",
  tentative: "You responded maybe",
};

// An invitation you haven't settled on yet - offer Accept/Decline as two
// direct choices instead of the single toggle used once you've responded,
// which would otherwise default to declining before you could accept.
function isUnconfirmedInvitation(attendance: { isInvitation: boolean; responseStatus: AttendanceStatus | null }): boolean {
  return (
    attendance.isInvitation &&
    (attendance.responseStatus === "needsAction" || attendance.responseStatus === "tentative")
  );
}

function toFormValues(event: CalendarEvent): EventFormValues {
  return {
    calendarKey: `${event.accountId}::${event.calendarId}`,
    title: event.title,
    // The rich (chip-bearing) value is what the editor loads - falls back
    // to the plain field for a row from before this split existed.
    description: event.descriptionRich ?? event.description ?? "",
    location: event.locationRich ?? event.location ?? "",
    allDay: event.allDay,
    start: event.allDay ? event.start : toDatetimeLocalInput(event.start),
    end: event.allDay ? event.end : toDatetimeLocalInput(event.end),
  };
}

export function EventViewPage() {
  const { accountId, calendarId, eventId } = useParams<{
    accountId: string;
    calendarId: string;
    eventId: string;
  }>();
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<EventFormValues | null>(null);

  const { data: event, isLoading, isError } = useQuery({
    queryKey: ["events", accountId, calendarId, eventId],
    queryFn: () => fetchEvent(Number(accountId), calendarId!, eventId!),
    enabled: Boolean(accountId && calendarId && eventId),
  });

  const updateMutation = useMutation({
    mutationFn: (v: EventFormValues) =>
      updateEvent(Number(accountId), calendarId!, eventId!, {
        title: v.title,
        descriptionRich: v.description || undefined,
        locationRich: v.location || undefined,
        allDay: v.allDay,
        start: v.start,
        end: v.end,
        timeZone: getBrowserTimeZone(),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["events", accountId, calendarId, eventId], updated);
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteEvent(Number(accountId), calendarId!, eventId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
      navigate(resolveChamberPath("/", "calendar", shellHosted));
    },
  });

  const attendanceMutation = useMutation({
    mutationFn: (notAttending: boolean) =>
      setEventAttendance(Number(accountId), calendarId!, eventId!, { notAttending }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["events", accountId, calendarId, eventId], updated);
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });

  // Loads form values from the server exactly once per event - a
  // background refetch of the same event must never stomp in-progress
  // local edits, but navigating to a different event must reset them.
  const eventKey = accountId && calendarId && eventId ? `${accountId}::${calendarId}::${eventId}` : null;
  const initializedEventKeyRef = useRef<string | null>(null);
  const readOnly = event ? !event.editable : false;
  const { markSaved } = useAutosave({
    value: values,
    enabled: values !== null && !readOnly,
    onSave: (v) => {
      if (v) updateMutation.mutate(v);
    },
  });
  useEffect(() => {
    if (event && eventKey && initializedEventKeyRef.current !== eventKey) {
      const formValues = toFormValues(event);
      setValues(formValues);
      markSaved(formValues);
      initializedEventKeyRef.current = eventKey;
    }
  }, [event, eventKey, markSaved]);

  const exhibitId =
    accountId && calendarId && eventId ? toExhibitId(Number(accountId), calendarId, eventId) : null;

  if (isLoading || !values) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (isError || !event) return <p className="font-mono text-sm text-alert">Failed to load this event.</p>;
  if (!exhibitId) return <p className="font-mono text-sm text-alert">Invalid event id.</p>;

  return (
    <section>
      <ExhibitLinksLayout
        exhibitId={exhibitId}
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("calendar", r, navigate, shellHosted)}
        editable
        actions={
          <ExhibitActionBar>
            <button
              type="button"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="tap-target text-alert hover:underline disabled:opacity-50"
            >
              {deleteMutation.isPending ? "Deleting —" : "Delete"}
            </button>
          </ExhibitActionBar>
        }
      >
        <EventForm
          values={values}
          onChange={setValues}
          calendarLocked
          readOnly={readOnly}
          error={updateMutation.error instanceof Error ? updateMutation.error.message : null}
        />

        <div className="mt-6 border-t border-dust pt-4">
          <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">
            {event.attendance.isInvitation ? "Invitation" : "Attendance"}
          </label>
          <p className="font-mono text-sm text-ink">
            {event.attendance.isInvitation
              ? RESPONSE_STATUS_LABELS[event.attendance.responseStatus ?? "needsAction"]
              : event.attendance.notAttending
                ? "Not attending"
                : "Attending"}
          </p>
          {isUnconfirmedInvitation(event.attendance) ? (
            <div className="mt-2 flex gap-4">
              <button
                type="button"
                onClick={() => attendanceMutation.mutate(false)}
                disabled={attendanceMutation.isPending}
                className="tap-target text-accent hover:underline disabled:opacity-50"
              >
                Accept
              </button>
              <button
                type="button"
                onClick={() => attendanceMutation.mutate(true)}
                disabled={attendanceMutation.isPending}
                className="tap-target text-alert hover:underline disabled:opacity-50"
              >
                Decline
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => attendanceMutation.mutate(!event.attendance.notAttending)}
              disabled={attendanceMutation.isPending}
              className="tap-target mt-2 text-accent hover:underline disabled:opacity-50"
            >
              {event.attendance.notAttending ? "Mark as attending" : "Mark as not attending"}
            </button>
          )}
        </div>

        {event.htmlLink && (
          <a
            href={event.htmlLink}
            target="_blank"
            rel="noreferrer"
            className="mt-6 inline-block font-mono text-xs uppercase tracking-wide text-slate hover:text-accent"
          >
            Open in Google Calendar ↗
          </a>
        )}
      </ExhibitLinksLayout>
    </section>
  );
}
