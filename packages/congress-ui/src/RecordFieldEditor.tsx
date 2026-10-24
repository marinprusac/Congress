import type { ReactNode } from "react";
import type { CapitolRecordResolveResult, CapitolRecordSearchResult } from "@congress/shared-types";
import { useRecordEditorCore } from "./codemirror/useRecordEditorCore.js";
import { RecordPickerDropdown } from "./RecordPickerDropdown.js";

interface RecordFieldEditorProps {
  value: string;
  onChange: (value: string) => void;
  // Renders as a live-previewed, un-editable surface (chips still resolve
  // and navigate) - a full replacement for both RecordTextarea (edit) and
  // RecordAnnotatedText/RecordMarkdown (read-only view): one component,
  // one always-live surface, instead of a separate view/edit mode pair.
  readOnly?: boolean;
  placeholder?: string;
  // Applied to the mounted CM6 editor's own root DOM node - every call site
  // still owns its exact look (border/padding/background), this component
  // only owns the "@" picker wiring, markdown live preview, and chip
  // rendering.
  className: string;
  wrapperClassName?: string;
  renderIcon: (chamber: string, type?: string) => ReactNode;
  onNavigate?: (result: Extract<CapitolRecordResolveResult, { url: string }>) => void;
  // Opt-in "Create <query>" affordance for a Chamber whose own records can
  // be quick-created from here (only Notes, today) - resolves to the newly
  // created Record, inserted exactly like a picked search result.
  onCreate?: (title: string) => Promise<CapitolRecordSearchResult>;
  // Approximate minimum height, in text rows - CM6 otherwise sizes to its
  // content with no minimum, which reads as an oddly cramped empty field.
  minRows?: number;
  autoFocus?: boolean;
  // Runs on Enter first; return true to consume it (e.g. send a message).
  onSubmitKey?: () => boolean;
}

// The shared multi-line editing/viewing surface: full Markdown (headers,
// lists, emphasis, links) live-previewed Obsidian-style, plus "@"-triggered
// record chips that render as atomic, invisible-as-code widgets at all
// times - not just in a separate read-only view. Replaces RecordTextarea,
// RecordMarkdown, and RecordAnnotatedText for every multi-line body/
// description field across every Chamber.
export function RecordFieldEditor({
  value,
  onChange,
  readOnly = false,
  placeholder,
  className,
  wrapperClassName = "record-field",
  renderIcon,
  onNavigate,
  onCreate,
  minRows,
  autoFocus,
  onSubmitKey,
}: RecordFieldEditorProps) {
  const { containerRef, picker } = useRecordEditorCore({
    value,
    onChange,
    readOnly,
    placeholder,
    mode: "multiline",
    renderIcon,
    onNavigate,
    onCreate,
    onSubmitKey,
    autoFocus,
  });

  return (
    <div className={wrapperClassName}>
      <div
        ref={containerRef}
        className={className}
        style={minRows ? { minHeight: `calc(${minRows} * 1.6em)` } : undefined}
      />
      {!readOnly && <RecordPickerDropdown picker={picker} renderIcon={renderIcon} className="record-picker-dropdown" />}
    </div>
  );
}
