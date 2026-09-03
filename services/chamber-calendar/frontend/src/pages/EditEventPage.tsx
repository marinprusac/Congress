import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useShellHosted,
  resolveChamberPath,
  PageHeader,
  ExhibitLinksLayout,
  navigateToExhibit,
  getChamberIcon,
  useAutosave,
} from "@congress/congress-ui";
import { EventForm, type EventFormValues } from "@/components/EventForm";
import { fetchEvent, updateEvent, deleteEvent } from "@/lib/api";
import { getBrowserTimeZone, toDatetimeLocalInput } from "@/lib/datetime";
import { toExhibitId } from "@/lib/exhibits";
import type { CalendarEvent } from "../../../src/types";

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

export function EditEventPage() {
  const { accountId, calendarId, eventId } = useParams<{
    accountId: string;
    calendarId: string;
    eventId: string;
  }>();
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<EventFormValues | null>(null);

  const { data, isLoading, isError } = useQuery({
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["events"] }),
  });

  // Loads form values from the server exactly once per event - a
  // background refetch of the same event must never stomp in-progress
  // local edits, but navigating to a different event must reset them.
  const eventKey = accountId && calendarId && eventId ? `${accountId}::${calendarId}::${eventId}` : null;
  const initializedEventKeyRef = useRef<string | null>(null);
  const readOnly = data ? !data.editable : false;
  const { markSaved } = useAutosave({
    value: values,
    enabled: values !== null && !readOnly,
    onSave: (v) => {
      if (v) updateMutation.mutate(v);
    },
  });
  useEffect(() => {
    if (data && eventKey && initializedEventKeyRef.current !== eventKey) {
      const formValues = toFormValues(data);
      setValues(formValues);
      markSaved(formValues);
      initializedEventKeyRef.current = eventKey;
    }
  }, [data, eventKey, markSaved]);

  const deleteMutation = useMutation({
    mutationFn: () => deleteEvent(Number(accountId), calendarId!, eventId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
      navigate(resolveChamberPath("/", "calendar", shellHosted));
    },
  });

  if (isLoading || !values) {
    return <p className="font-mono text-sm text-dust">Loading —</p>;
  }
  if (isError) {
    return <p className="font-mono text-sm text-alert">Failed to load this event.</p>;
  }

  return (
    <section>
      <PageHeader title="Edit Event" />
      <ExhibitLinksLayout
        exhibitId={toExhibitId(Number(accountId), calendarId!, eventId!)}
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("calendar", r, navigate, shellHosted)}
        editable
      >
        <EventForm
          values={values}
          onChange={setValues}
          calendarLocked
          readOnly={readOnly}
          onDelete={() => deleteMutation.mutate()}
          deleting={deleteMutation.isPending}
          error={
            updateMutation.error instanceof Error
              ? updateMutation.error.message
              : deleteMutation.error instanceof Error
                ? deleteMutation.error.message
                : null
          }
        />
      </ExhibitLinksLayout>
    </section>
  );
}
