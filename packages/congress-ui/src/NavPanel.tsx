import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { fetchRegistry } from "./registry.js";
import { ChamberMark, getChamberIcon } from "./ChamberMarks.js";
import { GlobalExhibitSearch } from "./GlobalExhibitSearch.js";
import { useShellHosted } from "./ShellHostContext.js";
import { useChamberOrder } from "./useChamberOrder.js";
import { useNavPanelSwipe } from "./useNavPanelSwipe.js";
import { useReorderableList } from "./useReorderableList.js";

interface NavPanelProps {
  // "capitol", a Chamber's manifest name, or "settings" - which entry is
  // highlighted as the one currently open.
  current: string;
  // Display name for the current Chamber's own row - rendered immediately
  // from this rather than waiting on the registry fetch below (which is
  // what supplies every *other* Chamber's icon/label/link). Without this,
  // the current Chamber's own row would flicker away any time the registry
  // fetch is slow or fails. Irrelevant/unused when current is "settings",
  // whose own row is always hardcoded regardless of the registry.
  currentLabel?: string;
}

interface PanelChamber {
  name: string;
  displayName: string;
  href: string;
}

// Capitol is an ordinary registered Chamber here, same as Notes/Calendar/...
// - no special-cased row, no fixed position, reorderable right alongside
// every other entry (see NavPanel's own top comment). Same
// "prepend the current Chamber if the registry hasn't caught up yet"
// reasoning the old ChamberPicker carried, so a Chamber's own row never
// flickers away while its registry entry is still loading.
function buildChamberList(
  registryChambers: { name: string; displayName: string; routes: { home: string } }[],
  current: string,
  currentLabel: string | undefined
): PanelChamber[] {
  const fromRegistry = registryChambers.map((c) => ({ name: c.name, displayName: c.displayName, href: c.routes.home }));
  if (current === "settings" || fromRegistry.some((c) => c.name === current)) {
    return fromRegistry;
  }
  return [{ name: current, displayName: currentLabel ?? current, href: `/${current}` }, ...fromRegistry];
}

function SettingsIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

// A NavPanel target (Capitol, Settings, another Chamber) is always a genuine
// cross-app jump, never this app's own internal route - only safe as a
// <Link> when this tree is shell-hosted (no basename in the way). Standalone
// (a Chamber's own `BrowserRouter basename="/<chamber>"`), it has to stay a
// real navigation via a plain <a>, same reasoning ChamberPicker's own
// ChamberIcon/CapitolLink used to carry. `onPointerDown`/`onClickCapture`/
// `rowRef` are only ever passed for a reorderable Chamber row (see
// useReorderableList) - Settings has nothing to drag, so it just omits them.
function CrossAppLink({
  to,
  shellHosted,
  className,
  ariaLabel,
  onNavigate,
  onPointerDown,
  onClickCapture,
  rowRef,
  children,
}: {
  to: string;
  shellHosted: boolean;
  className: string;
  ariaLabel?: string;
  onNavigate: () => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onClickCapture?: (e: React.MouseEvent) => void;
  rowRef?: (el: HTMLAnchorElement | null) => void;
  children: ReactNode;
}) {
  return shellHosted ? (
    <Link
      to={to}
      className={className}
      aria-label={ariaLabel}
      onClick={onNavigate}
      onPointerDown={onPointerDown}
      onClickCapture={onClickCapture}
      ref={rowRef}
      draggable={false}
    >
      {children}
    </Link>
  ) : (
    <a
      href={to}
      className={className}
      aria-label={ariaLabel}
      onPointerDown={onPointerDown}
      onClickCapture={onClickCapture}
      ref={rowRef}
      draggable={false}
    >
      {children}
    </a>
  );
}

// Icon-only, deliberately understated (dust, not the accent color a
// Chamber's own active row gets) - Settings is a utility destination, not
// one more entry in the list it sits apart from.
function SettingsRow({
  current,
  to,
  shellHosted,
  onNavigate,
  variant,
}: {
  current: string;
  // Carries the Chamber navigated away from (see NavPanel's own comment on
  // settingsHref) so SettingsPage can default to that Chamber's own tab
  // instead of always landing on General.
  to: string;
  shellHosted: boolean;
  onNavigate: () => void;
  variant: "desktop" | "mobile";
}) {
  const isCurrent = current === "settings";
  const className = `nav-panel-link nav-panel-link--settings nav-panel-link--${variant}${isCurrent ? " active" : ""}`;
  return (
    <CrossAppLink to={to} shellHosted={shellHosted} onNavigate={onNavigate} className={className} ariaLabel="Settings">
      <SettingsIcon className="nav-panel-icon-settings" />
    </CrossAppLink>
  );
}

function ChamberRow({
  chamber,
  current,
  shellHosted,
  onNavigate,
  variant,
  dragging,
  onPointerDown,
  onClickCapture,
  rowRef,
}: {
  chamber: PanelChamber;
  current: string;
  shellHosted: boolean;
  onNavigate: () => void;
  variant: "desktop" | "mobile";
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onClickCapture: (e: React.MouseEvent) => void;
  rowRef: (el: HTMLAnchorElement | null) => void;
}) {
  const isCurrent = current === chamber.name;
  const className = `nav-panel-link nav-panel-link--${variant}${isCurrent ? " active" : ""}${dragging ? " nav-panel-link--dragging" : ""}`;
  return (
    <CrossAppLink
      to={chamber.href}
      shellHosted={shellHosted}
      onNavigate={onNavigate}
      className={className}
      onPointerDown={onPointerDown}
      onClickCapture={onClickCapture}
      rowRef={rowRef}
    >
      <ChamberMark name={chamber.name} className="nav-panel-icon" />
      <span className="nav-panel-label">{chamber.displayName}</span>
    </CrossAppLink>
  );
}

// Persistent way to jump between any Chamber (Capitol included - it's an
// ordinary registered Chamber here, not special-cased) and Settings, instead
// of round-tripping through the homepage - a fixed, always-visible sidebar
// on desktop; on mobile, an off-canvas panel opened by swiping right from
// the screen's left edge (useNavPanelSwipe) rather than a persistent bottom
// bar, since that no longer leaves comfortable room for a reorderable list
// or a Settings entry - there's no separate open/close button either, the
// swipe gesture is the only trigger. The Chambers list is reorderable by
// long-press-and-drag (useReorderableList, persisted per-device via
// useChamberOrder); Settings isn't a Chamber and isn't part of that list,
// so it sits apart from it - pinned to the bottom of the sidebar on desktop
// (no divider line, just margin-driven spacing - see .nav-panel-desktop
// .nav-panel-link--settings in shared.css), and grouped with the search bar
// in one bottom row on mobile, both within comfortable one-handed thumb
// reach along with the Chambers list above them, which is the one part of
// this panel used constantly. Desktop and mobile each get their own
// useReorderableList instance (own row-ref bookkeeping) even though both
// read/write the same underlying order - only one variant is ever on-screen
// (and thus ever mid-drag) at a time.
export function NavPanel({ current, currentLabel }: NavPanelProps) {
  const { data } = useQuery({ queryKey: ["congress", "registry"], queryFn: fetchRegistry });
  const shellHosted = useShellHosted();
  const { open, dragOffsetPx, dragProgress, panelRef, close } = useNavPanelSwipe();
  const dragging = dragOffsetPx !== null;
  // Whichever Router this panel happens to be mounted under (Congress's own
  // top-level one when shell-hosted, or a standalone Chamber's own) - see
  // this file's own top comment on why that's always safe to call here
  // directly rather than threading a navigate prop through from every
  // caller the way GlobalExhibitSearch used to require of ChamberHeader.
  const navigate = useNavigate();
  // Search results from Capitol/Settings itself never route locally - only
  // an actual Chamber owns exhibits (see GlobalExhibitSearch's own
  // ownChamber doc).
  const searchOwnChamber = current === "capitol" || current === "settings" ? "" : current;
  // Carries the Chamber being left behind into Settings' own query string,
  // so NavPanel's single Settings entry point opens straight to that
  // Chamber's own tab instead of always defaulting to General - see
  // SettingsPage's own reading of "from". Already on Settings: nothing to
  // carry.
  const settingsTo = current === "settings" ? "/settings" : `/settings?from=${encodeURIComponent(current)}`;

  const registryChambers = (data ?? []).filter((c) => c.status === "active");
  const chambers = buildChamberList(registryChambers, current, currentLabel);
  const { order, setOrder, commitOrder } = useChamberOrder(chambers.map((c) => c.name));
  const orderedChambers = order
    .map((name) => chambers.find((c) => c.name === name))
    .filter((c): c is PanelChamber => Boolean(c));

  const desktopReorder = useReorderableList(order, setOrder, commitOrder);
  const mobileReorder = useReorderableList(order, setOrder, commitOrder);

  function renderChamberRows(variant: "desktop" | "mobile") {
    const reorder = variant === "desktop" ? desktopReorder : mobileReorder;
    return orderedChambers.map((chamber) => (
      <ChamberRow
        key={chamber.name}
        chamber={chamber}
        current={current}
        shellHosted={shellHosted}
        onNavigate={close}
        variant={variant}
        dragging={reorder.draggingName === chamber.name}
        onPointerDown={(e) => reorder.onPointerDown(chamber.name, e)}
        onClickCapture={reorder.onClickCapture}
        rowRef={reorder.setRowRef(chamber.name)}
      />
    ));
  }

  return (
    <>
      <nav className="nav-panel-desktop" aria-label="Navigation">
        <GlobalExhibitSearch
          ownChamber={searchOwnChamber}
          navigate={navigate}
          renderIcon={getChamberIcon}
          className="nav-panel-search"
        />
        <div className="nav-panel-chambers">{renderChamberRows("desktop")}</div>
        <SettingsRow current={current} to={settingsTo} shellHosted={shellHosted} onNavigate={close} variant="desktop" />
      </nav>

      <div
        className="nav-panel-backdrop"
        data-open={open}
        onClick={close}
        aria-hidden={!open}
        style={dragProgress !== null ? { opacity: dragProgress, transition: "none" } : undefined}
      />

      <nav
        className="nav-panel-mobile"
        aria-label="Navigation"
        data-open={open}
        data-dragging={dragging}
        ref={panelRef}
        style={dragOffsetPx !== null ? { transform: `translateX(${dragOffsetPx}px)`, transition: "none" } : undefined}
      >
        <div className="nav-panel-mobile-chambers">{renderChamberRows("mobile")}</div>
        <div className="nav-panel-mobile-bottom">
          <SettingsRow current={current} to={settingsTo} shellHosted={shellHosted} onNavigate={close} variant="mobile" />
          <GlobalExhibitSearch
            ownChamber={searchOwnChamber}
            navigate={(path) => {
              navigate(path);
              close();
            }}
            renderIcon={getChamberIcon}
            className="nav-panel-search"
          />
        </div>
      </nav>
    </>
  );
}
