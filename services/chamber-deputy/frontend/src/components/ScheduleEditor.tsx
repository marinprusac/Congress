import { TriggerEventPicker, type EventCatalogEntry } from "@congress/congress-ui";
import type { DirectiveScheduleType } from "../../../src/types";

export interface ScheduleDraft {
  scheduleType: DirectiveScheduleType | null;
  intervalMs: number | null;
  scheduleHour: number | null;
  scheduleMinute: number | null;
  scheduleDayOfWeek: number | null;
  scheduleTimeZone: string | null;
  triggerEventType: string | null;
}

export const EMPTY_SCHEDULE: ScheduleDraft = {
  scheduleType: null,
  intervalMs: null,
  scheduleHour: null,
  scheduleMinute: null,
  scheduleDayOfWeek: null,
  scheduleTimeZone: null,
  triggerEventType: null,
};

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const selectClass =
  "border border-dust bg-parchment px-2 py-1 text-ink normal-case tracking-normal focus:outline-none focus-visible:outline-2 focus-visible:outline-accent";
const numberInputClass = `${selectClass} w-24`;
const timeInputClass = `${selectClass} w-32`;

function timeInputValue(hour: number | null, minute: number | null): string {
  if (hour == null || minute == null) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

interface ScheduleEditorProps {
  value: ScheduleDraft;
  onChange: (next: ScheduleDraft) => void;
  eventCatalog: EventCatalogEntry[];
  eventCatalogLoading: boolean;
}

// One control for every way a directive can be scheduled: plain interval
// (existing), daily/weekly at a wall-clock time (new - see
// services/chamber-deputy/src/scheduling.ts for the zoned-time math this
// feeds), or immediately whenever a chosen cross-Chamber event fires (new -
// see eventReceive.ts). Used identically by NewDirectivePage and
// DirectiveViewPage's edit mode.
export function ScheduleEditor({ value, onChange, eventCatalog, eventCatalogLoading }: ScheduleEditorProps) {
  function setType(scheduleType: DirectiveScheduleType | null) {
    if (scheduleType !== "daily" && scheduleType !== "weekly") {
      onChange({ ...EMPTY_SCHEDULE, scheduleType });
      return;
    }
    // Auto-capture the owner's own browser time zone the first time a
    // wall-clock schedule is picked, rather than asking them to type an
    // IANA name - this Chamber's headless runs happen server-side, which
    // has no fixed zone of its own (see scheduling.ts's own comment).
    onChange({
      ...EMPTY_SCHEDULE,
      scheduleType,
      scheduleTimeZone: value.scheduleTimeZone ?? browserTimeZone(),
      scheduleDayOfWeek: scheduleType === "weekly" ? (value.scheduleDayOfWeek ?? 1) : null,
    });
  }

  function setTime(time: string) {
    if (!time) {
      onChange({ ...value, scheduleHour: null, scheduleMinute: null });
      return;
    }
    const parts = time.split(":");
    onChange({ ...value, scheduleHour: Number(parts[0] ?? 0), scheduleMinute: Number(parts[1] ?? 0) });
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wide text-slate">
        Run automatically
        <select
          value={value.scheduleType ?? ""}
          onChange={(e) => setType((e.target.value || null) as DirectiveScheduleType | null)}
          className={selectClass}
        >
          <option value="">manual / chat only</option>
          <option value="interval">every —</option>
          <option value="daily">daily at —</option>
          <option value="weekly">weekly on —</option>
          <option value="event">when an event fires</option>
        </select>
      </label>

      {value.scheduleType === "interval" && (
        <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wide text-slate">
          Every
          <input
            type="number"
            min={1}
            value={value.intervalMs != null ? Math.round(value.intervalMs / 60_000) : ""}
            onChange={(e) => onChange({ ...value, intervalMs: e.target.value.trim() ? Number(e.target.value) * 60_000 : null })}
            placeholder="minutes"
            className={numberInputClass}
          />
          minutes
        </label>
      )}

      {(value.scheduleType === "daily" || value.scheduleType === "weekly") && (
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs uppercase tracking-wide text-slate">
          {value.scheduleType === "weekly" && (
            <>
              On
              <select
                value={value.scheduleDayOfWeek ?? ""}
                onChange={(e) => onChange({ ...value, scheduleDayOfWeek: Number(e.target.value) })}
                className={selectClass}
              >
                {DAY_LABELS.map((label, index) => (
                  <option key={label} value={index}>
                    {label}
                  </option>
                ))}
              </select>
            </>
          )}
          At
          <input type="time" value={timeInputValue(value.scheduleHour, value.scheduleMinute)} onChange={(e) => setTime(e.target.value)} className={timeInputClass} />
          <span className="normal-case tracking-normal text-dust">({value.scheduleTimeZone ?? browserTimeZone()})</span>
        </div>
      )}

      {value.scheduleType === "event" && (
        <div className="font-mono text-xs uppercase tracking-wide text-slate">
          <span className="mb-1 block">When</span>
          <TriggerEventPicker
            value={value.triggerEventType ?? ""}
            onChange={(triggerEventType) => onChange({ ...value, triggerEventType })}
            catalog={eventCatalog}
            loading={eventCatalogLoading}
            selectClassName={selectClass}
          />
        </div>
      )}
    </div>
  );
}
