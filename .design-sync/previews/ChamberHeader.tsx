import { ChamberHeader, CapitolMark, ChamberMark, NotificationBell } from "@congress/congress-ui";

// Real usage, ported verbatim from the three call sites in the app:
// - CapitolHeader.tsx: the richest composition - global search, per-chamber
//   icon rendering, and Capitol's own NotificationBell passed as extraActions
//   (deliberately not baked into ChamberHeader itself - see its own comment).
// - ChamberLayout.tsx: every Chamber's own header - same shape minus
//   extraActions, ownChamber set to the Chamber's own name.
// - SharedViewPage.tsx: the minimal case - no search (a token-scoped visitor
//   has no session for it to hit), no navigate, title-only.

export function InCapitol() {
  return (
    <ChamberHeader
      icon={<CapitolMark className="h-8 w-8 text-ink" />}
      title="Capitol"
      ownChamber=""
      renderIcon={(chamber) => <ChamberMark name={chamber} />}
      navigate={() => {}}
      extraActions={<NotificationBell ownChamber="" navigate={() => {}} />}
    />
  );
}

export function InChamber() {
  return (
    <ChamberHeader
      icon={<ChamberMark name="notes" className="h-8 w-8 text-ink" />}
      title="Notes"
      ownChamber="notes"
      renderIcon={(chamber) => <ChamberMark name={chamber} />}
      navigate={() => {}}
    />
  );
}

export function SharedView() {
  return (
    <ChamberHeader
      icon={<CapitolMark className="h-8 w-8 text-ink" />}
      title="For Claude — architecture"
      showSearch={false}
    />
  );
}
