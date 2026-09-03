import type { CSSProperties, ReactNode } from "react";
import type { CapitolExhibitSearchResult } from "@congress/shared-types";
import { useKeyboardInset } from "./useKeyboardInset.js";

// The display/selection contract this dropdown renders off of - owned here
// rather than by whatever produces it, since this component is the one
// actual reader of every field. The CM6-based editors (see
// codemirror/useExhibitEditorCore.ts) are the only current producer.
export interface ExhibitPickerState {
  open: boolean;
  query: string;
  results: CapitolExhibitSearchResult[];
  loading: boolean;
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  select: (result: CapitolExhibitSearchResult) => void;
  showCreate: boolean;
  creating: boolean;
  createError: string | null;
  createNew: () => void;
  // Client/viewport coordinates (exactly what CM6's own coordsAtPos
  // returns) of the "[[" trigger's own line - the one anchor placePicker
  // below positions this dropdown against, on every viewport size.
  caretPosition: { top: number; bottom: number; left: number } | null;
}

interface ExhibitPickerDropdownProps {
  picker: ExhibitPickerState;
  renderIcon: (chamber: string) => ReactNode;
  className?: string;
}

const GAP_PX = 6; // clearance between the caret's own line and the popup
const MARGIN_PX = 8; // never closer than this to any viewport edge
const WIDTH_PX = 320; // compact, fixed - never the full screen width
const MAX_HEIGHT_PX = 280; // compact, Obsidian-sized - not a half-screen sheet
const MIN_HEIGHT_PX = 88; // never shrunk tighter than this, even on the cramped side
const PREFERRED_BELOW_PX = 160; // "enough room below" - skip flipping above it

// Where to place the popup relative to the caret it's anchored to: below by
// default (reading order, and where the on-screen keyboard already isn't),
// flipped above only when below is genuinely cramped and above has more
// room to offer - the same rule Obsidian's own "[[" picker uses, so the
// line being written is never covered by its own picker and the picker
// itself is never clipped by a screen edge or the keyboard. Pure position:
// fixed math against the caret's own viewport coordinates (already
// keyboard-exclusive - the caret can't sit under the keyboard while it's
// being typed into, and the browser keeps it scrolled into view) rather
// than a measure-then-reposition render pass, so there's no first-frame
// flicker while this settles - `max-height` + the dropdown's own
// `overflow-y: auto` do the rest for however many results actually render
// short of that.
function placePicker(
  caret: { top: number; bottom: number; left: number },
  keyboardInset: number
): CSSProperties {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const usableBottom = viewportHeight - keyboardInset;

  const width = Math.min(WIDTH_PX, Math.max(0, viewportWidth - MARGIN_PX * 2));
  const left = Math.min(Math.max(caret.left, MARGIN_PX), Math.max(MARGIN_PX, viewportWidth - width - MARGIN_PX));

  const spaceBelow = usableBottom - caret.bottom - GAP_PX;
  const spaceAbove = caret.top - GAP_PX - MARGIN_PX;
  const below = spaceBelow >= PREFERRED_BELOW_PX || spaceBelow >= spaceAbove;
  const maxHeight = Math.max(MIN_HEIGHT_PX, Math.min(MAX_HEIGHT_PX, below ? spaceBelow : spaceAbove));

  return below
    ? { top: caret.bottom + GAP_PX, left, width, maxHeight }
    : { bottom: viewportHeight - caret.top + GAP_PX, left, width, maxHeight };
}

// Positioned by placePicker as a caret-anchored overlay (position: fixed
// applies its own top/bottom/left/width/maxHeight inline, per-render) - the
// editor keeps focus throughout, so keyboard nav (handled in
// useExhibitEditorCore) and click selection both work regardless of where
// this renders.
//
// Always renders its container, toggling only the `hidden` attribute -
// mounting/unmounting this DOM node exactly when "[[" is typed was enough to
// make mobile browsers reset the textarea's caret to the end of the value
// (and occasionally drop the next keystroke), since it's a layout mutation
// happening right as the focused element changes.
export function ExhibitPickerDropdown({ picker, renderIcon, className }: ExhibitPickerDropdownProps) {
  const keyboardInset = useKeyboardInset();
  const style = picker.caretPosition ? placePicker(picker.caretPosition, keyboardInset) : undefined;

  return (
    <div
      className={className}
      role="listbox"
      hidden={!picker.open}
      style={style}
    >
      {picker.loading && picker.results.length === 0 && (
        <div className="exhibit-picker-empty">Searching —</div>
      )}
      {!picker.loading && picker.results.length === 0 && !picker.showCreate && (
        <div className="exhibit-picker-empty">
          {picker.query.trim() ? "No matches" : "— Nothing to reference yet —"}
        </div>
      )}
      {picker.results.map((result: CapitolExhibitSearchResult, index: number) => (
        <div
          key={`${result.chamber}:${result.id}`}
          role="option"
          aria-selected={index === picker.activeIndex}
          className={index === picker.activeIndex ? "exhibit-picker-option active" : "exhibit-picker-option"}
          onMouseEnter={() => picker.setActiveIndex(index)}
          // mousedown, not click - fires before the textarea's blur handler
          // would otherwise close the picker first.
          onMouseDown={(e) => {
            e.preventDefault();
            picker.select(result);
          }}
        >
          <span className="exhibit-picker-icon">{renderIcon(result.chamber)}</span>
          <span className="exhibit-picker-name">{result.name}</span>
        </div>
      ))}
      {picker.showCreate && (
        <div
          role="option"
          aria-selected={picker.activeIndex === picker.results.length}
          className={
            picker.activeIndex === picker.results.length
              ? "exhibit-picker-option exhibit-picker-create active"
              : "exhibit-picker-option exhibit-picker-create"
          }
          onMouseEnter={() => picker.setActiveIndex(picker.results.length)}
          onMouseDown={(e) => {
            e.preventDefault();
            picker.createNew();
          }}
        >
          <span className="exhibit-picker-name">
            {picker.creating ? "Creating —" : `+ Create "${picker.query.trim()}"`}
          </span>
        </div>
      )}
      {picker.createError && <div className="exhibit-picker-error">{picker.createError}</div>}
    </div>
  );
}
