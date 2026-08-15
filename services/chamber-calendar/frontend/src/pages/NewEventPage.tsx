import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useShellHosted, resolveChamberPath, PageHeader } from "@congress/exhibit-ui";
import { EventForm, type EventFormValues } from "@/components/EventForm";
import { createEvent } from "@/lib/api";
import { getBrowserTimeZone } from "@/lib/datetime";

function defaultValues(): EventFormValues {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() + 1);
  const end = new Date(now.getTime() + 60 * 60 * 1000);
  const toLocalInput = (d: Date) => d.toISOString().slice(0, 16);
  return {
    calendarKey: "",
    title: "",
    description: "",
    location: "",
    allDay: false,
    start: toLocalInput(now),
    end: toLocalInput(end),
  };
}

export function NewEventPage() {
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<EventFormValues>(() => ({
    ...defaultValues(),
    title: searchParams.get("title") ?? "",
  }));

  const mutation = useMutation({
    mutationFn: () => {
      const [accountId, calendarId] = values.calendarKey.split("::") as [string, string];
      return createEvent({
        accountId: Number(accountId),
        calendarId,
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

  return (
    <section>
      <PageHeader title="New Event" />
      <EventForm
        values={values}
        onChange={setValues}
        onSubmit={() => mutation.mutate()}
        submitting={mutation.isPending}
        submitLabel="Create Event"
        error={mutation.error instanceof Error ? mutation.error.message : null}
      />
    </section>
  );
}
