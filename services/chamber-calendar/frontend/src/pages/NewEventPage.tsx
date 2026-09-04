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
import { addMinutesToLocalInput, getBrowserTimeZone, nextHalfHourSlot, toDatetimeLocalInput } from "@/lib/datetime";
import { toExhibitId } from "@/lib/exhibits";

const DEFAULT_DURATION_MINUTES = 60;

// The exact <input type="datetime-local"> shape a `start` query param has to
// match to be trusted - a malformed or hand-edited one falls back to the
// ordinary rounded-to-now default instead of reaching an invalid Date into
// the form.
const DATETIME_LOCAL_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

// `start` (and, only from a desktop click-drag on the Agenda's own timeline -
// see AgendaGapRow - `duration`, in minutes) let the Agenda hand off a
// picked time straight into a prefilled create form, instead of always
// landing here at defaultValues()'s own rounded-to-now guess.
function defaultValues(searchParams: URLSearchParams): EventFormValues {
  const startParam = searchParams.get("start");
  const start =
    startParam && DATETIME_LOCAL_PATTERN.test(startParam)
      ? startParam
      : toDatetimeLocalInput(nextHalfHourSlot(new Date()).toISOString());
  const durationParam = Number(searchParams.get("duration"));
  return {
    calendarKey: "",
    title: "",
    description: "",
    location: "",
    allDay: false,
    start,
    end: start.slice(0, 10),
    durationMinutes: durationParam > 0 ? durationParam : DEFAULT_DURATION_MINUTES,
  };
}

export function NewEventPage() {
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<EventFormValues>(() => ({
    ...defaultValues(searchParams),
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
        end: values.allDay ? values.end : addMinutesToLocalInput(values.start, values.durationMinutes),
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
