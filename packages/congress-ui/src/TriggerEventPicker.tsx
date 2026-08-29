import { useMemo } from "react";
import { getChamberIcon } from "./ChamberMarks.js";
import type { EventCatalogEntry } from "./eventCatalog.js";

interface TriggerEventPickerProps {
  value: string;
  onChange: (value: string) => void;
  catalog: EventCatalogEntry[];
  loading?: boolean;
  selectClassName: string;
}

interface ChamberOption {
  name: string;
  displayName: string;
}

// Two linked pickers - which Chamber, then which of that Chamber's own
// declared events - replacing a freetext "type and hope it matches" input.
// Built entirely from the live registry's manifest.events catalog (see
// eventCatalog.ts), so it only ever offers event types a currently-
// registered Chamber actually declares; nothing here is hardcoded to a
// specific Chamber or event name. Shared between chamber-automation's rule
// editor and chamber-deputy's event-triggered directives - both pick "which
// Chamber, which of its event types" against the exact same live catalog.
export function TriggerEventPicker({ value, onChange, catalog, loading, selectClassName }: TriggerEventPickerProps) {
  const selectedEntry = catalog.find((entry) => entry.type === value);

  const chambers = useMemo<ChamberOption[]>(() => {
    const seen = new Map<string, string>();
    for (const entry of catalog) seen.set(entry.chamber, entry.chamberDisplayName);
    // An existing rule's saved trigger might belong to a Chamber
    // that's since gone offline/unregistered, so it's missing from the
    // live catalog above - keep its own row (best-effort, from the
    // "chamber.event_name" convention every publisher today follows, not
    // an enforced schema) so opening the edit form never silently
    // discards a trigger the picker itself has nothing to replace it with.
    if (value && !selectedEntry) {
      const [guessedChamber] = value.split(".");
      if (guessedChamber && !seen.has(guessedChamber)) seen.set(guessedChamber, guessedChamber);
    }
    return Array.from(seen, ([name, displayName]) => ({ name, displayName })).sort((a, b) =>
      a.displayName.localeCompare(b.displayName)
    );
  }, [catalog, value, selectedEntry]);

  const selectedChamber = selectedEntry?.chamber ?? (value ? value.split(".")[0] : "");
  const events = catalog.filter((entry) => entry.chamber === selectedChamber);

  function selectChamber(chamber: string) {
    const firstEvent = catalog.find((entry) => entry.chamber === chamber);
    onChange(firstEvent ? firstEvent.type : "");
  }

  return (
    <div>
      <div className="flex gap-2">
        <select
          value={selectedChamber}
          onChange={(e) => selectChamber(e.target.value)}
          disabled={loading || chambers.length === 0}
          className={selectClassName}
          aria-label="Chamber"
        >
          <option value="" disabled>
            {loading ? "Loading —" : chambers.length === 0 ? "— No Chambers declare events —" : "— Chamber —"}
          </option>
          {chambers.map((chamber) => (
            <option key={chamber.name} value={chamber.name}>
              {chamber.displayName}
            </option>
          ))}
        </select>

        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={loading || !selectedChamber}
          className={selectClassName}
          aria-label="Event"
        >
          <option value="" disabled>
            — Event —
          </option>
          {!selectedEntry && value && <option value={value}>{value} (not currently declared)</option>}
          {events.map((entry) => (
            <option key={entry.type} value={entry.type}>
              {entry.label}
            </option>
          ))}
        </select>
      </div>
      {selectedEntry && (
        <p className="mt-1 flex items-center gap-1.5 font-mono text-xs text-dust">
          <span className="h-3.5 w-3.5 flex-shrink-0">{getChamberIcon(selectedEntry.chamber)}</span>
          {selectedEntry.description ?? `${selectedEntry.chamberDisplayName} — ${selectedEntry.label}`}
        </p>
      )}
    </div>
  );
}
