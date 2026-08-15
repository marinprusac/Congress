import { CapitolMark } from "@congress/exhibit-ui";

// Real usage: CapitolHeader.tsx renders the Capitol hub mark exactly this
// way — "h-8 w-8 text-ink" inside a "flex items-center gap-3" row next to
// the wordmark. Shown here on the app's parchment background so the ink
// color reads correctly.

export function Default() {
  return (
    <div className="flex items-center gap-3 bg-parchment p-3">
      <CapitolMark className="h-8 w-8 text-ink" />
    </div>
  );
}

// Muted/dust coloring is a real pattern (see WidgetGrid.tsx, which dims
// ChamberMark to text-dust for offline chambers) — shown here for Capitol's
// own mark in case a muted context is needed (e.g. a disabled state).
export function Muted() {
  return (
    <div className="flex items-center gap-3 bg-parchment p-3">
      <CapitolMark className="h-8 w-8 text-dust" />
    </div>
  );
}
