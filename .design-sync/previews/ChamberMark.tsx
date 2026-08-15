import { ChamberMark } from "@congress/exhibit-ui";

// Real usage: each Chamber's Layout.tsx renders its own mark exactly this
// way — "h-8 w-8 text-ink" — next to the Chamber name in the sidebar header
// (see chamber-notes/chamber-calendar/chamber-tasks Layout.tsx). Only
// classes confirmed present in the compiled exhibit-ui stylesheet are used
// here (h-8/w-8/text-ink/bg-parchment/flex/items-center/gap-3/p-3).

export function Notes() {
  return (
    <div className="flex items-center gap-3 bg-parchment p-3">
      <ChamberMark name="notes" className="h-8 w-8 text-ink" />
    </div>
  );
}

export function Calendar() {
  return (
    <div className="flex items-center gap-3 bg-parchment p-3">
      <ChamberMark name="calendar" className="h-8 w-8 text-ink" />
    </div>
  );
}

export function Documents() {
  return (
    <div className="flex items-center gap-3 bg-parchment p-3">
      <ChamberMark name="documents" className="h-8 w-8 text-ink" />
    </div>
  );
}

export function Tasks() {
  return (
    <div className="flex items-center gap-3 bg-parchment p-3">
      <ChamberMark name="tasks" className="h-8 w-8 text-ink" />
    </div>
  );
}

// Unrecognized chamber names fall back to DefaultChamberMark (a plain
// diamond) rather than rendering nothing — used by Capitol's homepage
// WidgetGrid, which renders every registered Chamber's mark generically.
export function UnrecognizedFallback() {
  return (
    <div className="flex items-center gap-3 bg-parchment p-3">
      <ChamberMark name="unknown-chamber" className="h-8 w-8 text-ink" />
    </div>
  );
}
