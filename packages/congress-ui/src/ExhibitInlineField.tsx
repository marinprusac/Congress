import type { ReactNode } from "react";
import type { CapitolExhibitResolveResult, CapitolExhibitSearchResult } from "@congress/shared-types";
import { useExhibitEditorCore } from "./codemirror/useExhibitEditorCore.js";
import { ExhibitPickerDropdown } from "./ExhibitPickerDropdown.js";

interface ExhibitInlineFieldProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  className: string;
  wrapperClassName?: string;
  renderIcon: (chamber: string) => ReactNode;
  onNavigate?: (result: Extract<CapitolExhibitResolveResult, { url: string }>) => void;
  onCreate?: (title: string) => Promise<CapitolExhibitSearchResult>;
  autoFocus?: boolean;
  // Called on Enter instead of inserting a line break (this field never
  // holds more than one line) - e.g. submitting the surrounding form.
  onEnter?: () => void;
}

// Single-line counterpart to <ExhibitFieldEditor>: exhibit chips plus inline
// emphasis (bold/italic/links) only, no block-level Markdown (headers,
// lists) - for fields like Calendar's location, replacing a bespoke
// <input type="text"> with one that can hold and live-preview an exhibit
// reference too.
export function ExhibitInlineField({
  value,
  onChange,
  readOnly = false,
  placeholder,
  className,
  wrapperClassName = "exhibit-field",
  renderIcon,
  onNavigate,
  onCreate,
  autoFocus,
  onEnter,
}: ExhibitInlineFieldProps) {
  const { containerRef, picker } = useExhibitEditorCore({
    value,
    onChange,
    readOnly,
    placeholder,
    mode: "inline",
    renderIcon,
    onNavigate,
    onCreate,
    onEnter,
    autoFocus,
  });

  return (
    <div className={wrapperClassName}>
      <div ref={containerRef} className={className} />
      {!readOnly && <ExhibitPickerDropdown picker={picker} renderIcon={renderIcon} className="exhibit-picker-dropdown docked-sheet" />}
    </div>
  );
}
