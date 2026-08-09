import type { ReactNode } from "react";
import type { CapitolExhibitSearchResult } from "@congress/shared-types";
import type { ExhibitPickerState } from "./useExhibitPicker.js";

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
  return (
    <div className={className} role="listbox" hidden={!picker.open}>
      {picker.loading && picker.results.length === 0 && (
        <div className="exhibit-picker-empty">Searching —</div>
      )}
      {!picker.loading && picker.results.length === 0 && (
        <div className="exhibit-picker-empty">No matches</div>
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
    </div>
  );
}
