import type { ReactNode } from "react";
import type { CapitolExhibitSearchResult } from "@congress/shared-types";
import type { ExhibitPickerState } from "./useExhibitPicker.js";

interface ExhibitPickerDropdownProps {
  picker: ExhibitPickerState;
  renderIcon: (chamber: string) => ReactNode;
  className?: string;
}

// Renders inline, directly under the textarea it's attached to - not
// caret-positioned. Keeps this v1 implementation simple; the textarea keeps
// focus throughout, so keyboard nav (handled in useExhibitPicker) and click
// selection both work regardless of where this renders.
export function ExhibitPickerDropdown({ picker, renderIcon, className }: ExhibitPickerDropdownProps) {
  if (!picker.open) return null;

  return (
    <div className={className} role="listbox">
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
