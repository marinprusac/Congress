import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExhibitFieldEditor, ExhibitInlineField, FormLabel, getChamberIcon } from "@congress/congress-ui";
import { fetchSelectedCalendars } from "@/lib/api";
import { formatGapDuration } from "@/lib/datetime";

export interface EventFormValues {
  calendarKey: string; // `${accountId}::${googleCalendarId}`
  title: string;
  description: string;
  location: string;
  allDay: boolean;
  start: string;
  // Multi-day all-day end date - only used while allDay is set. A timed
  // event's end is never stored directly; it's start + durationMinutes.
  end: string;
  durationMinutes: number;
}

// Common meeting lengths offered as <datalist> suggestions - the field
// itself stays a plain minutes number, so any other value is just as valid
// to type, only less discoverable.
const DURATION_PRESET_MINUTES = [15, 30, 45, 60, 90, 120, 180, 240];

interface EventFormProps {
  values: EventFormValues;
  onChange: (values: EventFormValues) => void;
  calendarLocked?: boolean;
  // Set for an event this account can't modify (e.g. an auto-added Gmail
  // reservation whose organizer is a Google service) - every field becomes
  // read-only; deleting it is handled by the caller's own action bar,
  // outside this form, and stays available either way.
  readOnly?: boolean;
}

// The metadata fields shared by an event's view and create flows - not the
// title (its caller renders that the same way every other exhibit's view
// page does: a plain, borderless heading input) and not a submit button
// (a view page autosaves, a create page fires its own mutation from its own
// action bar) - just calendar/time/location/description, styled to read as
// an exhibit's own fields rather than a form waiting to be filled in.
export function EventForm({ values, onChange, calendarLocked, readOnly }: EventFormProps) {
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

  // Start's own stored string switches shape along with its input's type
  // (date vs. datetime-local, just above) - toggling allDay without also
  // converting it left the old shape sitting in a field that no longer
  // accepts it, which a browser silently renders as blank rather than
  // rejecting. The date portion is a valid prefix of either shape, so a
  // plain slice converts cleanly in both directions; going back to timed
  // just needs *some* time of day, since a bare date never carried one.
  function handleAllDayToggle(checked: boolean) {
    const date = values.start.slice(0, 10);
    if (checked) {
      onChange({ ...values, allDay: true, start: date, end: date });
    } else {
      onChange({ ...values, allDay: false, start: `${date}T09:00` });
    }
  }

  return (
    <div className="space-y-6">
      {readOnly && (
        <p className="font-mono text-sm text-dust">
          This event is managed by its organizer, not this account, so it can't be edited here — it can still be
          removed from the calendar.
        </p>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-4">
        <div>
          <FormLabel>Calendar</FormLabel>
          <select
            value={values.calendarKey}
            onChange={(e) => set("calendarKey", e.target.value)}
            disabled={calendarLocked || readOnly}
            required
            className="field-plain font-mono text-base disabled:text-dust"
          >
            <option value="" disabled>
              Select —
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

        <label className="flex items-center gap-2 self-end pb-1 font-mono text-xs uppercase tracking-wide text-slate">
          <input
            type="checkbox"
            checked={values.allDay}
            onChange={(e) => handleAllDayToggle(e.target.checked)}
            disabled={readOnly}
            className="checkbox"
          />
          All day
        </label>

        <div className={values.allDay ? "min-w-0" : "min-w-0 col-span-2"}>
          <FormLabel>Start</FormLabel>
          <input
            type={values.allDay ? "date" : "datetime-local"}
            value={values.start}
            onChange={(e) => set("start", e.target.value)}
            step={values.allDay ? undefined : 900}
            required
            readOnly={readOnly}
            className="field-plain font-mono text-base"
          />
        </div>
        {values.allDay ? (
          <div className="min-w-0">
            <FormLabel>End</FormLabel>
            <input
              type="date"
              value={values.end}
              onChange={(e) => set("end", e.target.value)}
              required
              readOnly={readOnly}
              className="field-plain font-mono text-base"
            />
          </div>
        ) : (
          <div className="min-w-0 col-span-2">
            <FormLabel>Duration</FormLabel>
            <input
              type="number"
              min={5}
              step={15}
              list="duration-presets"
              value={values.durationMinutes}
              onChange={(e) => set("durationMinutes", Number(e.target.value))}
              required
              readOnly={readOnly}
              className="field-plain font-mono text-base"
            />
            <datalist id="duration-presets">
              {DURATION_PRESET_MINUTES.map((m) => (
                <option key={m} value={m}>
                  {formatGapDuration(m)}
                </option>
              ))}
            </datalist>
          </div>
        )}

        <div className="col-span-2">
          <FormLabel>Location</FormLabel>
          <ExhibitInlineField
            value={values.location}
            onChange={(newValue) => set("location", newValue)}
            readOnly={readOnly}
            placeholder="Location (optional)"
            className="field-plain font-body text-base focus-within:outline-none"
            renderIcon={(chamber) => getChamberIcon(chamber)}
          />
        </div>
      </div>

      <div>
        <FormLabel>Description</FormLabel>
        <ExhibitFieldEditor
          value={values.description}
          onChange={(newValue) => set("description", newValue)}
          readOnly={readOnly}
          minRows={3}
          placeholder="Description (optional), @ to reference an Exhibit"
          className="w-full bg-parchment py-1 font-body text-base text-ink focus-within:outline-none"
          renderIcon={(chamber) => getChamberIcon(chamber)}
        />
      </div>
    </div>
  );
}
