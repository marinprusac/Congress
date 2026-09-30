import { useState } from "react";
import { FormLabel } from "@congress/congress-ui";
import { fromLocalInput, toLocalInput } from "./datetime";
import { allDayRange, DEFAULT_MINUTES, DURATIONS, describeRange, lastDay, localDate, minutesBetween, moveStart, plusMinutes, toggleAllDay } from "./timeRange";

// A type's time range (start/end, all day) as one control: a start and a
// duration, or first and last day.

export interface RangeValue {
  start: string | null;
  end: string | null;
  allDay: boolean;
}

interface Props {
  value: RangeValue;
  onChange: (next: RangeValue) => void;
  hasAllDay: boolean;
  readOnly?: boolean;
}

function formatMinutes(m: number): string {
  return m < 60 ? `${m} min` : m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function TimeRangeControl({ value, onChange, hasAllDay, readOnly }: Props) {
  const minutes = minutesBetween(value.start, value.end) ?? DEFAULT_MINUTES;
  const [custom, setCustom] = useState(!DURATIONS.includes(minutes));

  if (readOnly) {
    return (
      <div className="min-w-0">
        <FormLabel>When</FormLabel>
        <p className="font-mono text-base text-slate">{describeRange(value.start, value.end, value.allDay)}</p>
      </div>
    );
  }

  const setAllDay = (allDay: boolean) => {
    const start = value.start ?? new Date().toISOString();
    onChange({ ...toggleAllDay(start, value.end, allDay), allDay });
  };

  return (
    <div className="min-w-0 space-y-3">
      {hasAllDay && (
        <label className="flex items-center justify-between gap-4">
          <FormLabel>All day</FormLabel>
          <input type="checkbox" className="checkbox" checked={value.allDay} onChange={(e) => setAllDay(e.target.checked)} />
        </label>
      )}
      {value.allDay ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <FormLabel>First day</FormLabel>
            <input
              type="date"
              className="field-plain w-full font-mono text-base"
              value={value.start ? localDate(value.start) : ""}
              onChange={(e) => e.target.value && onChange({ ...allDayRange(e.target.value, value.start ? lastDay(value.start, value.end) : e.target.value), allDay: true })}
            />
          </div>
          <div className="min-w-0">
            <FormLabel>Last day</FormLabel>
            <input
              type="date"
              className="field-plain w-full font-mono text-base"
              value={value.start ? lastDay(value.start, value.end) : ""}
              onChange={(e) => value.start && e.target.value && onChange({ ...allDayRange(localDate(value.start), e.target.value), allDay: true })}
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <FormLabel>Starts</FormLabel>
            <input
              type="datetime-local"
              step={900}
              className="field-plain w-full font-mono text-base"
              value={toLocalInput(value.start)}
              onChange={(e) => {
                const next = fromLocalInput(e.target.value);
                if (next) onChange({ ...moveStart(value.start, value.end, next), allDay: false });
              }}
            />
          </div>
          <div className="min-w-0">
            <FormLabel>Duration</FormLabel>
            <div className="flex items-center gap-2">
              <select
                className="field-plain min-w-0 flex-1 font-mono text-base"
                value={custom ? "custom" : String(minutes)}
                onChange={(e) => {
                  if (e.target.value === "custom") return setCustom(true);
                  setCustom(false);
                  if (value.start) onChange({ start: value.start, end: plusMinutes(value.start, Number(e.target.value)), allDay: false });
                }}
              >
                {DURATIONS.map((m) => (
                  <option key={m} value={m}>
                    {formatMinutes(m)}
                  </option>
                ))}
                <option value="custom">Custom</option>
              </select>
              {custom && (
                <input
                  type="number"
                  min={5}
                  step={5}
                  inputMode="numeric"
                  aria-label="Minutes"
                  className="field-plain w-20 font-mono text-base"
                  value={minutes}
                  onChange={(e) => {
                    const m = Number(e.target.value);
                    if (value.start && m > 0) onChange({ start: value.start, end: plusMinutes(value.start, m), allDay: false });
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
