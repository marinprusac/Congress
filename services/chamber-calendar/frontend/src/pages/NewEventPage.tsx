import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useShellHosted,
  resolveChamberPath,
  ExhibitActionBar,
  ExhibitLinksLayout,
  navigateToExhibit,
  getChamberIcon,
  flushDraftConnections,
  FormErrorMessage,
} from "@congress/congress-ui";
import type { CapitolExhibitSearchResult } from "@congress/shared-types";
import { EventForm, type EventFormValues } from "@/components/EventForm";
import { createEvent } from "@/lib/api";
import { getBrowserTimeZone } from "@/lib/datetime";
import { toExhibitId } from "@/lib/exhibits";

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
  // Staged locally (ExhibitLinksLayout's `exhibitId={null}` mode) since a new
  // event has no id - Google Calendar only issues one once the event is
  // actually created below - and only actually written via
  // flushDraftConnections once that real id exists.
  const [draftConnections, setDraftConnections] = useState<CapitolExhibitSearchResult[]>([]);

  const mutation = useMutation({
    mutationFn: async () => {
      const [accountId, calendarId] = values.calendarKey.split("::") as [string, string];
      const created = await createEvent({
        accountId: Number(accountId),
        calendarId,
        title: values.title,
        descriptionRich: values.description || undefined,
        locationRich: values.location || undefined,
        allDay: values.allDay,
        start: values.start,
        end: values.end,
        timeZone: getBrowserTimeZone(),
      });
      await flushDraftConnections(toExhibitId(created.accountId, created.calendarId, created.id), draftConnections);
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
      navigate(resolveChamberPath("/", "calendar", shellHosted));
    },
  });

  return (
    <article>
      <div className="mb-6 border-b border-dust pb-4">
        <input
          autoFocus
          value={values.title}
          onChange={(e) => setValues({ ...values, title: e.target.value })}
          placeholder="Title"
          className="w-full font-display text-3xl text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />
      </div>

      {mutation.isError && <FormErrorMessage>{(mutation.error as Error).message}</FormErrorMessage>}

      <ExhibitLinksLayout
        exhibitId={null}
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("calendar", r, navigate, shellHosted)}
        editable
        draftConnections={draftConnections}
        onDraftConnectionsChange={setDraftConnections}
        actions={
          <ExhibitActionBar>
            <button
              onClick={() => values.title.trim() && values.calendarKey && mutation.mutate()}
              disabled={!values.title.trim() || !values.calendarKey || mutation.isPending}
              className="tap-target text-accent hover:underline disabled:opacity-50"
            >
              {mutation.isPending ? "Creating —" : "Create"}
            </button>
            <button
              onClick={() => navigate(resolveChamberPath("/", "calendar", shellHosted))}
              className="tap-target text-slate hover:underline"
            >
              Cancel
            </button>
          </ExhibitActionBar>
        }
      >
        <EventForm values={values} onChange={setValues} />
      </ExhibitLinksLayout>
    </article>
  );
}
