import type { ReactNode } from "react";
import type { CapitolExhibitResolveResult, CapitolExhibitSearchResult } from "@congress/shared-types";
import { useExhibitEditorCore } from "./codemirror/useExhibitEditorCore.js";
import { ExhibitPickerDropdown } from "./ExhibitPickerDropdown.js";

interface ExhibitFieldEditorProps {
  value: string;
  onChange: (value: string) => void;
  // Renders as a live-previewed, un-editable surface (chips still resolve
  // and navigate) - a full replacement for both ExhibitTextarea (edit) and
  // ExhibitAnnotatedText/ExhibitMarkdown (read-only view): one component,
  // one always-live surface, instead of a separate view/edit mode pair.
  readOnly?: boolean;
  placeholder?: string;
  // Applied to the mounted CM6 editor's own root DOM node - every call site
  // still owns its exact look (border/padding/background), this component
  // only owns the "@" picker wiring, markdown live preview, and chip
  // rendering.
  className: string;
  wrapperClassName?: string;
  renderIcon: (chamber: string) => ReactNode;
  onNavigate?: (result: Extract<CapitolExhibitResolveResult, { url: string }>) => void;
  // Opt-in "Create <query>" affordance for a Chamber whose own exhibits can
  // be quick-created from here (only Notes, today) - resolves to the newly
  // created Exhibit, inserted exactly like a picked search result.
  onCreate?: (title: string) => Promise<CapitolExhibitSearchResult>;
  // Approximate minimum height, in text rows - CM6 otherwise sizes to its
  // content with no minimum, which reads as an oddly cramped empty field.
  minRows?: number;
  autoFocus?: boolean;
}

// The shared multi-line editing/viewing surface: full Markdown (headers,
// lists, emphasis, links) live-previewed Obsidian-style, plus "@"-triggered
// exhibit chips that render as atomic, invisible-as-code widgets at all
// times - not just in a separate read-only view. Replaces ExhibitTextarea,
// ExhibitMarkdown, and ExhibitAnnotatedText for every multi-line body/
// description field across every Chamber.
export function ExhibitFieldEditor({
  value,
  onChange,
  readOnly = false,
  placeholder,
  className,
  wrapperClassName = "exhibit-field",
  renderIcon,
  onNavigate,
  onCreate,
  minRows,
  autoFocus,
}: ExhibitFieldEditorProps) {
  const { containerRef, picker } = useExhibitEditorCore({
    value,
    onChange,
    readOnly,
    placeholder,
    mode: "multiline",
    renderIcon,
    onNavigate,
    onCreate,
    autoFocus,
  });

  return (
    <div className={wrapperClassName}>
      <div
        ref={containerRef}
        className={className}
        style={minRows ? { minHeight: `calc(${minRows} * 1.6em)` } : undefined}
      />
      {!readOnly && <ExhibitPickerDropdown picker={picker} renderIcon={renderIcon} className="exhibit-picker-dropdown" />}
    </div>
  );
}
