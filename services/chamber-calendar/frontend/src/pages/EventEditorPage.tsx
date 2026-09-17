import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useShellHosted,
  resolveChamberPath,
  ExhibitActionBar,
  ExhibitLinksLayout,
  navigateToExhibit,
  getChamberIcon,
  flushDraftConnections,
  showToast,
  useAutosave,
  useDraftCreate,
  resolveEditorIdentity,
  FormErrorMessage,
} from "@congress/congress-ui";
import type { CapitolExhibitSearchResult } from "@congress/shared-types";
import { EventForm, type EventFormValues } from "@/components/EventForm";
import { createEvent, fetchEvent, updateEvent, moveEvent, deleteEvent, setEventAttendance } from "@/lib/api";
import { addMinutesToLocalInput, getBrowserTimeZone, minutesBetween, nextHalfHourSlot, toDatetimeLocalInput } from "@/lib/datetime";
import { toExhibitId, isLocalEvent } from "@/lib/exhibits";
import type { AttendanceStatus, CalendarEvent } from "../../../src/types";

const DEFAULT_DURATION_MINUTES = 60;

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

// The exact <input type="datetime-local"> shape a `start` query param has to
// match to be trusted - a malformed or hand-edited one falls back to the
// ordinary rounded-to-now default instead of reaching an invalid Date into
// the form.
const DATETIME_LOCAL_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

// `start` (and, only from a desktop click-drag on the Agenda's own timeline -
// see AgendaGapRow - `duration`, in minutes) let the Agenda hand off a
// picked time straight into a prefilled create form, instead of always
// landing on defaultValues()'s own rounded-to-now guess.
function defaultValues(searchParams: URLSearchParams): EventFormValues {
  const startParam = searchParams.get("start");
  const start =
    startParam && DATETIME_LOCAL_PATTERN.test(startParam)
      ? startParam
      : toDatetimeLocalInput(nextHalfHourSlot(new Date()).toISOString());
  const durationParam = Number(searchParams.get("duration"));
  return {
    calendarKey: "",
    title: searchParams.get("title") ?? "",
    description: "",
    location: "",
    allDay: false,
    start,
    end: start.slice(0, 10),
    durationMinutes: durationParam > 0 ? durationParam : DEFAULT_DURATION_MINUTES,
  };
}

function toFormValues(event: CalendarEvent): EventFormValues {
  return {
    // "" is EventForm's own "Local" value (see its header comment) - a
    // local event has no real Google account/calendar pair to build a
    // matching option value from, same blank key a fresh draft starts with.
    calendarKey: isLocalEvent(event) ? "" : `${event.accountId}::${event.calendarId}`,
    title: event.title,
    // The rich (chip-bearing) value is what the editor loads - falls back
    // to the plain field for a row from before this split existed.
    description: event.descriptionRich ?? event.description ?? "",
    location: event.locationRich ?? event.location ?? "",
    allDay: event.allDay,
    start: event.allDay ? event.start : toDatetimeLocalInput(event.start),
    end: event.allDay ? event.end : toDatetimeLocalInput(event.start), // unused while !allDay; see durationMinutes
    durationMinutes: event.allDay ? 0 : minutesBetween(event.start, event.end),
  };
}

interface EventIdentity {
  accountId: number;
  calendarId: string;
  eventId: string;
}

function parseEventIdentity(params: { accountId?: string; calendarId?: string; eventId?: string }): EventIdentity | null {
  if (!params.accountId || !params.calendarId || !params.eventId) return null;
  const accountId = Number(params.accountId);
  if (!Number.isInteger(accountId)) return null;
  return { accountId, calendarId: params.calendarId, eventId: params.eventId };
}

// A plain string so resolveEditorIdentity (which compares by `===`) can
// tell two identities apart - the object itself is rebuilt fresh on every
// parse and would never compare equal to itself.
function identityKey(id: EventIdentity | null): string | null {
  return id ? `${id.accountId}::${id.calendarId}::${id.eventId}` : null;
}

// Matches AgendaPage's own prefetchEvent queryKey exactly (String(accountId),
// not the number fetchEvent itself takes) - see its own comment for why a
// mismatch here silently turns the prefetch into a wasted, never-read cache
// entry rather than a visible bug.
function eventQueryKey(id: EventIdentity | null) {
  return ["events", id ? String(id.accountId) : undefined, id?.calendarId, id?.eventId] as const;
}

// Handles both "create" (route `/new`, no id) and "edit" (route
// `/e/:accountId/:calendarId/:eventId`) as one mounted component - see
// chamber-notes' NoteEditorPage, which this mirrors, for the full reasoning
// behind merging the two. The event id here is a composite key rather than
// a single local auto-increment (Google's own account+calendar+event
// triple), and moving an event to a different calendar reassigns that whole
// key - moveMutation's own `navigate(..., { replace: true })` deliberately
// does *not* touch `eventIdentity` itself, so the identity-reset effect
// below treats it exactly like navigating to a genuinely different event
// (repopulating from the server), which is what a Google-reissued id should
// do - only the *create* flow's replace is meant to preserve local state.
export function EventEditorPage() {
  const params = useParams<{ accountId: string; calendarId: string; eventId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();

  const [eventIdentity, setEventIdentity] = useState<EventIdentity | null>(() => parseEventIdentity(params));
  const [values, setValues] = useState<EventFormValues | null>(() =>
    eventIdentity === null ? defaultValues(searchParams) : null
  );
  const [draftConnections, setDraftConnections] = useState<CapitolExhibitSearchResult[]>([]);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  const { data: event, isLoading, isError } = useQuery({
    queryKey: eventQueryKey(eventIdentity),
    queryFn: () => fetchEvent(eventIdentity!.accountId, eventIdentity!.calendarId, eventIdentity!.eventId),
    enabled: eventIdentity !== null,
  });

  const createMutation = useMutation({
    mutationFn: async (v: EventFormValues) => {
      // An empty calendarKey (the field's own default - see EventForm) means
      // "store this locally": accountId/calendarId are left out of the
      // request entirely rather than sent as some sentinel, which is what
      // tells the backend to create a local event instead of a Google one
      // (see types.ts's createEventRequestSchema).
      const [accountId, calendarId] = v.calendarKey ? (v.calendarKey.split("::") as [string, string]) : [undefined, undefined];
      const created = await createEvent({
        accountId: accountId !== undefined ? Number(accountId) : undefined,
        calendarId,
        title: v.title,
        descriptionRich: v.description || undefined,
        locationRich: v.location || undefined,
        allDay: v.allDay,
        start: v.start,
        end: v.allDay ? v.end : addMinutesToLocalInput(v.start, v.durationMinutes),
        timeZone: getBrowserTimeZone(),
      });
      await flushDraftConnections(toExhibitId(created.accountId, created.calendarId, created.id), draftConnections);
      return created;
    },
    onSuccess: (created, v) => {
      const createdIdentity: EventIdentity = { accountId: created.accountId, calendarId: created.calendarId, eventId: created.id };
      queryClient.setQueryData(eventQueryKey(createdIdentity), created);
      queryClient.invalidateQueries({ queryKey: ["events"] });
      if (eventIdentity !== null) return;
      initializedEventKeyRef.current = identityKey(createdIdentity);
      markSaved(v);
      currentCalendarKeyRef.current = v.calendarKey;
      setEventIdentity(createdIdentity);
      navigate(
        resolveChamberPath(
          `/e/${created.accountId}/${encodeURIComponent(created.calendarId)}/${encodeURIComponent(created.id)}`,
          "calendar",
          shellHosted
        ),
        { replace: true }
      );
    },
    onError: () => {
      draftCreate.reset();
      showToast("Failed to create event.", "error");
    },
  });

  // Fires on the title field's blur (see the input's onBlur below) rather
  // than a content-change debounce - see useDraftCreate's own comment.
  const draftCreate = useDraftCreate({
    value: values,
    canCreate: (v) => eventIdentity === null && v !== null && v.title.trim().length > 0,
    onCreate: (v) => v && createMutation.mutate(v),
  });

  // A navigation between two different events, or back to the draft/"new"
  // route, reuses this same mounted component - see resolveEditorIdentity's
  // own comment. Also what a calendar-move's own navigate below runs into:
  // since that mutation deliberately doesn't touch `eventIdentity` itself,
  // this effect treats the new url exactly like a different event and
  // repopulates from the server, matching this page's pre-merge behavior.
  useEffect(() => {
    const fromUrl = parseEventIdentity(params);
    if (resolveEditorIdentity(identityKey(fromUrl), identityKey(eventIdentity)) === "keep") return;
    draftCreate.attempt();
    setEventIdentity(fromUrl);
    setValues(fromUrl === null ? defaultValues(searchParams) : null);
    setDraftConnections([]);
    initializedEventKeyRef.current = null;
    draftCreate.reset();
    if (fromUrl === null) titleInputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.accountId, params.calendarId, params.eventId, eventIdentity]);

  const updateMutation = useMutation({
    mutationFn: (v: EventFormValues) =>
      updateEvent(eventIdentity!.accountId, eventIdentity!.calendarId, eventIdentity!.eventId, {
        title: v.title,
        descriptionRich: v.description || undefined,
        locationRich: v.location || undefined,
        allDay: v.allDay,
        start: v.start,
        end: v.allDay ? v.end : addMinutesToLocalInput(v.start, v.durationMinutes),
        timeZone: getBrowserTimeZone(),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(eventQueryKey(eventIdentity), updated);
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });

  // Changing the Calendar field is a structural move (see calendar.ts's
  // moveEvent), not an ordinary field edit - fired immediately on selection
  // rather than folded into the debounced autosave below, and the event's id
  // changes with it, so the only way to land on the moved event afterward is
  // a navigate to its new URL. currentCalendarKeyRef tracks the value last
  // confirmed by the server so a fresh load (including the one after this
  // mutation's own navigate) is never mistaken for a user-initiated move.
  const currentCalendarKeyRef = useRef<string | null>(null);
  const moveMutation = useMutation({
    mutationFn: (calendarKey: string) => {
      const [targetAccountId, targetCalendarId] = calendarKey ? (calendarKey.split("::") as [string, string]) : [undefined, undefined];
      return moveEvent(eventIdentity!.accountId, eventIdentity!.calendarId, eventIdentity!.eventId, {
        accountId: targetAccountId !== undefined ? Number(targetAccountId) : undefined,
        calendarId: targetCalendarId,
        timeZone: targetAccountId !== undefined ? getBrowserTimeZone() : undefined,
      });
    },
    onSuccess: (moved) => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
      navigate(
        resolveChamberPath(
          `/e/${moved.accountId}/${encodeURIComponent(moved.calendarId)}/${encodeURIComponent(moved.id)}`,
          "calendar",
          shellHosted
        ),
        { replace: true }
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteEvent(eventIdentity!.accountId, eventIdentity!.calendarId, eventIdentity!.eventId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
      navigate(resolveChamberPath("/", "calendar", shellHosted));
      showToast("Event deleted");
    },
    onError: () => showToast("Failed to delete event.", "error"),
  });

  const attendanceMutation = useMutation({
    mutationFn: (notAttending: boolean) =>
      setEventAttendance(eventIdentity!.accountId, eventIdentity!.calendarId, eventIdentity!.eventId, { notAttending }),
    onSuccess: (updated) => {
      queryClient.setQueryData(eventQueryKey(eventIdentity), updated);
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });

  // Loads form values from the server exactly once per event - a
  // background refetch of the same event must never stomp in-progress
  // local edits, but navigating to a different event must reset them. Also
  // covers the just-created event: its query is pre-seeded via
  // setQueryData above, so this effect's `markSaved` runs immediately
  // without feeding a stale/empty server value back into the editor.
  const eventKey = identityKey(eventIdentity);
  const initializedEventKeyRef = useRef<string | null>(null);
  const isDraft = eventIdentity === null;
  const readOnly = event ? !event.editable : false;
  const { markSaved } = useAutosave({
    value: values,
    enabled: values !== null && !isDraft && eventKey === initializedEventKeyRef.current && !readOnly,
    onSave: (v) => {
      if (v) updateMutation.mutate(v);
    },
  });
  useEffect(() => {
    if (event && eventKey && initializedEventKeyRef.current !== eventKey) {
      const formValues = toFormValues(event);
      setValues(formValues);
      markSaved(formValues);
      currentCalendarKeyRef.current = formValues.calendarKey;
      initializedEventKeyRef.current = eventKey;
    }
  }, [event, eventKey, markSaved]);

  // Intercepted rather than folded into setValues directly while editing an
  // existing event - see moveMutation above for why a Calendar change needs
  // its own, immediate path instead of waiting on the debounced autosave.
  // While still a draft there's nothing to move yet, so a Calendar pick is
  // just an ordinary field edit.
  function handleFormChange(next: EventFormValues) {
    if (!isDraft && next.calendarKey !== currentCalendarKeyRef.current && !moveMutation.isPending) {
      moveMutation.mutate(next.calendarKey);
      return;
    }
    setValues(next);
  }

  if (!isDraft && (isLoading || !values)) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (!isDraft && (isError || !event)) return <p className="font-mono text-sm text-alert">Failed to load this event.</p>;
  if (!values) return <p className="font-mono text-sm text-dust">Loading —</p>;

  const exhibitId = eventIdentity ? toExhibitId(eventIdentity.accountId, eventIdentity.calendarId, eventIdentity.eventId) : null;

  return (
    <article>
      <div className="mb-6 border-b border-dust pb-4">
        <input
          ref={titleInputRef}
          autoFocus={isDraft}
          value={values.title}
          onChange={(e) => setValues({ ...values, title: e.target.value })}
          onBlur={() => draftCreate.attempt()}
          placeholder={isDraft ? "Title" : "Untitled"}
          readOnly={!isDraft && readOnly}
          className="w-full font-display text-3xl text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />
      </div>

      {createMutation.isError && <FormErrorMessage>{(createMutation.error as Error).message}</FormErrorMessage>}
      {(updateMutation.isError || moveMutation.isError) && (
        <p className="mb-4 font-mono text-sm text-alert">{((moveMutation.error ?? updateMutation.error) as Error).message}</p>
      )}

      <ExhibitLinksLayout
        exhibitId={isDraft ? null : exhibitId}
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("calendar", r, navigate, shellHosted)}
        editable
        draftConnections={draftConnections}
        onDraftConnectionsChange={setDraftConnections}
        actions={
          <ExhibitActionBar>
            {isDraft ? (
              <button
                onClick={() => navigate(resolveChamberPath("/", "calendar", shellHosted))}
                className="tap-target text-slate hover:underline"
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="tap-target text-alert hover:underline disabled:opacity-50"
              >
                {deleteMutation.isPending ? "Deleting —" : "Delete"}
              </button>
            )}
          </ExhibitActionBar>
        }
      >
        <EventForm
          values={values}
          onChange={handleFormChange}
          calendarLocked={moveMutation.isPending}
          readOnly={!isDraft && readOnly}
        />

        {!isDraft && event && (
          <div className="mt-6">
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
        )}

        {!isDraft && event?.htmlLink && (
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
    </article>
  );
}
