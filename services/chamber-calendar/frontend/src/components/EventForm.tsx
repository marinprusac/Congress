import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExhibitFieldEditor, ExhibitInlineField, getChamberIcon } from "@congress/congress-ui";
import { fetchSelectedCalendars } from "@/lib/api";

export interface EventFormValues {
  calendarKey: string; // `${accountId}::${googleCalendarId}`
  title: string;
  description: string;
  location: string;
  allDay: boolean;
  start: string;
  end: string;
}

interface EventFormProps {
  values: EventFormValues;
  onChange: (values: EventFormValues) => void;
  calendarLocked?: boolean;
  // Omit entirely for an autosaving caller (editing an existing event) -
  // the form then has no submit button at all, since every field change is
  // already persisted by the caller's own autosave. Pass it only for a
  // creation flow, where the record doesn't exist yet and one explicit
  // action is still what instantiates it.
  onSubmit?: () => void;
  submitting?: boolean;
  submitLabel?: string;
  onDelete?: () => void;
  deleting?: boolean;
  error?: string | null;
  // Set for an event this account can't modify (e.g. an auto-added Gmail
  // reservation whose organizer is a Google service) - every field becomes
  // read-only and the save action disappears, but onDelete still works:
  // removing such an event from the calendar is always allowed even when
  // editing its content isn't.
  readOnly?: boolean;
}

export function EventForm({
  values,
  onChange,
  calendarLocked,
  onSubmit,
  submitting,
  submitLabel,
  onDelete,
  deleting,
  error,
  readOnly,
}: EventFormProps) {
  const { data: calendars } = useQuery({
    queryKey: ["calendars", "selected"],
    queryFn: fetchSelectedCalendars,
  });

  const grouped = useMemo(() => {
    if (!calendars) return [];
    const byAccount = new Map<string, typeof calendars>();
    for (const cal of calendars.filter((c) => c.selected)) {
      const list = byAccount.get(cal.accountLabel) ?? [];
      list.push(cal);
      byAccount.set(cal.accountLabel, list);
    }
    return [...byAccount.entries()];
  }, [calendars]);

  function set<K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) {
    onChange({ ...values, [key]: value });
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
      }}
    >
      {error && <div className="border border-alert px-3 py-2 font-mono text-sm text-alert">{error}</div>}

      {readOnly && (
        <div className="border border-dust px-3 py-2 font-mono text-sm text-slate">
          This event is managed by its organizer, not this account, so it can't be edited here — it can still be
          removed from the calendar.
        </div>
      )}

      <div>
        <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">Calendar</label>
        <select
          value={values.calendarKey}
          onChange={(e) => set("calendarKey", e.target.value)}
          disabled={calendarLocked || readOnly}
          required
          className="w-full border border-dust bg-parchment px-3 py-2 font-mono text-base text-ink disabled:text-dust"
        >
          <option value="" disabled>
            Select a calendar —
          </option>
          {grouped.map(([accountLabel, cals]) => (
            <optgroup key={accountLabel} label={accountLabel}>
              {cals.map((cal) => (
                <option key={cal.id} value={`${cal.accountId}::${cal.googleCalendarId}`}>
                  {cal.summary}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">Title</label>
        <input
          type="text"
          value={values.title}
          onChange={(e) => set("title", e.target.value)}
          required
          readOnly={readOnly}
          className="w-full border border-dust bg-parchment px-3 py-2 font-display text-lg text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />
      </div>

      <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wide text-slate">
        <input
          type="checkbox"
          checked={values.allDay}
          onChange={(e) => set("allDay", e.target.checked)}
          disabled={readOnly}
        />
        All day
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">Start</label>
          <input
            type={values.allDay ? "date" : "datetime-local"}
            value={values.start}
            onChange={(e) => set("start", e.target.value)}
            required
            readOnly={readOnly}
            className="w-full min-w-0 border border-dust bg-parchment px-3 py-2 font-mono text-base text-ink"
          />
        </div>
        <div className="min-w-0">
          <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">End</label>
          <input
            type={values.allDay ? "date" : "datetime-local"}
            value={values.end}
            onChange={(e) => set("end", e.target.value)}
            required
            readOnly={readOnly}
            className="w-full min-w-0 border border-dust bg-parchment px-3 py-2 font-mono text-base text-ink"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">Location</label>
        <ExhibitInlineField
          value={values.location}
          onChange={(newValue) => set("location", newValue)}
          readOnly={readOnly}
          placeholder="Location (optional)"
          className="w-full border border-dust bg-parchment px-3 py-2 font-body text-base text-ink focus-within:outline-none"
          renderIcon={(chamber) => getChamberIcon(chamber)}
        />
      </div>

      <div>
        <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">Description</label>
        <ExhibitFieldEditor
          value={values.description}
          onChange={(newValue) => set("description", newValue)}
          readOnly={readOnly}
          minRows={4}
          placeholder="Description (optional), @ to reference an Exhibit"
          className="w-full bg-parchment px-3 py-2 font-body text-base text-ink focus-within:outline-none"
          renderIcon={(chamber) => getChamberIcon(chamber)}
        />
      </div>

      <div className="flex items-center justify-between border-t border-dust pt-4">
        {!readOnly && onSubmit ? (
          <button
            type="submit"
            disabled={submitting}
            className="border border-ink px-4 py-2 font-mono text-xs uppercase tracking-wide text-ink hover:bg-ink hover:text-parchment disabled:opacity-50"
          >
            {submitting ? "Saving —" : submitLabel}
          </button>
        ) : (
          <span />
        )}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="tap-target font-mono text-xs uppercase tracking-wide text-alert hover:underline disabled:opacity-50"
          >
            {deleting ? "Deleting —" : "Delete"}
          </button>
        )}
      </div>
    </form>
  );
}
