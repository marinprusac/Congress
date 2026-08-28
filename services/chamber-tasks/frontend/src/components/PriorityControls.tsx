import { PRIORITY_LEVELS, type PriorityLevel } from "@congress/shared-types";

// Mirrors chamber-logs' own PriorityThresholdSelect (EventSettingsDetailPage.tsx)
// - same <select> over PRIORITY_LEVELS, just for the task's own priority
// rather than a rule's minimum-priority floor.
export function PrioritySelect({ value, onChange }: { value: PriorityLevel; onChange: (v: PriorityLevel) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as PriorityLevel)}
      className="border border-dust bg-parchment px-3 py-2 font-mono text-base text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
    >
      {PRIORITY_LEVELS.map((level) => (
        <option key={level} value={level}>
          {level}
        </option>
      ))}
    </select>
  );
}

// Silent for "normal" (the common case, not worth calling out) and "low"
// (deliberately de-emphasized) - only high/urgent tasks earn a visible
// marker in list/widget rows, the same restraint as the due-date label
// they sit next to.
export function PriorityMark({ priority }: { priority: PriorityLevel }) {
  if (priority === "urgent") return <span className="shrink-0 font-mono text-xs text-alert">urgent</span>;
  if (priority === "high") return <span className="shrink-0 font-mono text-xs text-alert">high</span>;
  return null;
}
