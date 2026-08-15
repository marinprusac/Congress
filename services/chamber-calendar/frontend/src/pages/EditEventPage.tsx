import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useShellHosted, resolveChamberPath, PageHeader } from "@congress/congress-ui";
import { EventForm, type EventFormValues } from "@/components/EventForm";
import { fetchEvent, updateEvent, deleteEvent } from "@/lib/api";
import { getBrowserTimeZone, toDatetimeLocalInput } from "@/lib/datetime";
import type { CalendarEvent } from "../../../src/types";

function toFormValues(event: CalendarEvent): EventFormValues {
  return {
    calendarKey: `${event.accountId}::${event.calendarId}`,
    title: event.title,
    description: event.description ?? "",
    location: event.location ?? "",
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

  useEffect(() => {
    if (data) setValues(toFormValues(data));
  }, [data]);

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!values) throw new Error("Form not loaded");
      return updateEvent(Number(accountId), calendarId!, eventId!, {
        title: values.title,
        description: values.description || undefined,
        location: values.location || undefined,
        allDay: values.allDay,
        start: values.start,
        end: values.end,
        timeZone: getBrowserTimeZone(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
      navigate(resolveChamberPath("/", "calendar", shellHosted));
    },
  });

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
      <EventForm
        values={values}
        onChange={setValues}
        calendarLocked
        readOnly={data ? !data.editable : false}
        onSubmit={() => updateMutation.mutate()}
        submitting={updateMutation.isPending}
        submitLabel="Save Changes"
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
    </section>
  );
}
