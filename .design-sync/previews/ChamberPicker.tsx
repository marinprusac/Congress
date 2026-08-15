import type { ReactNode } from "react";
import { ChamberPicker } from "@congress/exhibit-ui";

// Real usage: mounted once per app, fixed-position (sidebar on desktop,
// bottom bar on mobile) — see ChamberLayout.tsx (`current` = that Chamber's
// own manifest name) and Capitol's App.tsx (`current="capitol"`). Both
// forms render in the same output regardless of viewport; only CSS decides
// which is visible.

// Matches ChamberLayout's real Notes usage — see
// services/chamber-notes/frontend/src/App.tsx.
const NOTES_NAV_LINKS = [
  { to: "/", label: "All Notes" },
  { to: "/new", label: "New" },
  { to: "/settings", label: "Settings" },
];

// Matches Capitol's real CAPITOL_NAV_LINKS in
// services/capitol/frontend/src/App.tsx.
const CAPITOL_NAV_LINKS = [
  { to: "/shares", label: "Shares" },
  { to: "/settings", label: "Settings" },
];

// ChamberPicker's entire render tree is `position: fixed` (no normal-flow
// content of its own) - in real usage it's always mounted alongside a
// sibling page that has real height (ChamberLayout's `.chamber-shell` sets
// `min-height: 100vh`, Capitol's own pages do the same), which is what
// gives the fixed elements a properly-sized document to anchor against. A
// bare `<ChamberPicker>` with no such sibling has a zero-height document,
// so this wrapper reproduces that real-world condition rather than
// changing anything about the component itself.
function PageHeightWrapper({ children }: { children: ReactNode }) {
  return <div style={{ minHeight: "800px" }}>{children}</div>;
}

export function InNotes() {
  return (
    <PageHeightWrapper>
      <ChamberPicker current="notes" currentNavLinks={NOTES_NAV_LINKS} currentLabel="Notes" />
    </PageHeightWrapper>
  );
}

export function InCapitol() {
  return (
    <PageHeightWrapper>
      <ChamberPicker current="capitol" currentNavLinks={CAPITOL_NAV_LINKS} />
    </PageHeightWrapper>
  );
}
