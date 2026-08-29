import type { ReactNode } from "react";
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
  // Anchor point for the dropdown, relative to the .exhibit-field wrapper -
  // consumed only by the desktop CSS rule (see shared.css), which is caret-
  // anchored; the mobile rule stays fixed-to-viewport and ignores this.
  caretPosition: { top: number; left: number } | null;
}

interface ExhibitPickerDropdownProps {
  picker: ExhibitPickerState;
  renderIcon: (chamber: string) => ReactNode;
  className?: string;
}

// Positioned by CSS as a viewport-anchored overlay (not caret-positioned) -
// the textarea keeps focus throughout, so keyboard nav (handled in
// useExhibitPicker) and click selection both work regardless of where this
// renders.
//
// Always renders its container, toggling only the `hidden` attribute -
// mounting/unmounting this DOM node exactly when "[[" is typed was enough to
// make mobile browsers reset the textarea's caret to the end of the value
// (and occasionally drop the next keystroke), since it's a layout mutation
// happening right as the focused element changes.
export function ExhibitPickerDropdown({ picker, renderIcon, className }: ExhibitPickerDropdownProps) {
  const keyboardInset = useKeyboardInset();

  const style: Record<string, string> = {};
  if (keyboardInset > 0) style.bottom = `calc(0.5rem + ${keyboardInset}px)`;
  // Consumed only by the desktop rule (see styles.css) - the mobile rule
  // stays fixed-to-viewport and ignores these, since a caret-relative
  // position makes no sense once the picker sits above the keyboard.
  if (picker.caretPosition) {
    style["--picker-caret-top"] = `${picker.caretPosition.top}px`;
    style["--picker-caret-left"] = `${picker.caretPosition.left}px`;
  }

  return (
    <div
      className={className}
      role="listbox"
      hidden={!picker.open}
      style={Object.keys(style).length > 0 ? style : undefined}
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
