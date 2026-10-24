import type { ReactNode } from "react";
import type { CapitolRecordResolveResult, CapitolRecordSearchResult } from "@congress/shared-types";
import { useRecordEditorCore } from "./codemirror/useRecordEditorCore.js";
import { RecordPickerDropdown } from "./RecordPickerDropdown.js";

interface RecordInlineFieldProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  className: string;
  wrapperClassName?: string;
  renderIcon: (chamber: string, type?: string) => ReactNode;
  onNavigate?: (result: Extract<CapitolRecordResolveResult, { url: string }>) => void;
  onCreate?: (title: string) => Promise<CapitolRecordSearchResult>;
  autoFocus?: boolean;
  // Called on Enter instead of inserting a line break (this field never
  // holds more than one line) - e.g. submitting the surrounding form.
  onEnter?: () => void;
}

// Single-line counterpart to <RecordFieldEditor>: record chips plus inline
// emphasis (bold/italic/links) only, no block-level Markdown (headers,
// lists) - for fields like Calendar's location, replacing a bespoke
// <input type="text"> with one that can hold and live-preview a record
// reference too.
export function RecordInlineField({
  value,
  onChange,
  readOnly = false,
  placeholder,
  className,
  wrapperClassName = "record-field",
  renderIcon,
  onNavigate,
  onCreate,
  autoFocus,
  onEnter,
}: RecordInlineFieldProps) {
  const { containerRef, picker } = useRecordEditorCore({
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
      {!readOnly && <RecordPickerDropdown picker={picker} renderIcon={renderIcon} className="record-picker-dropdown" />}
    </div>
  );
}
