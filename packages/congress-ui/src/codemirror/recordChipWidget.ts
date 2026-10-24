import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WidgetType } from "@codemirror/view";
import type { CapitolRecordResolveResult } from "@congress/shared-types";
import { RecordChip } from "../RecordChip.js";
import type { RecordEditorRuntimeRef } from "./runtime.js";

function resultsEqual(a: CapitolRecordResolveResult, b: CapitolRecordResolveResult): boolean {
  if (a.id !== b.id || a.chamber !== b.chamber) return false;
  if ("deleted" in a || "deleted" in b) return "deleted" in a && "deleted" in b;
  if ("unavailable" in a || "unavailable" in b) return "unavailable" in a && "unavailable" in b;
  return a.name === b.name && a.url === b.url;
}

// Replaces a `[[record:chamber:id|Label]]` span in the document with a
// mounted <RecordChip> - this, plus registering the same range via
// EditorView.atomicRanges (see recordChipDecorations.ts), is what makes an
// record reference genuinely invisible-as-code rather than merely styled:
// the caret and Backspace treat the whole widget as one unit, and the raw
// bracket-token text never renders at all, in edit or read-only mode alike.
//
// RecordChip itself takes an already-resolved `result` prop and does no
// fetching of its own, so mounting it into a *separate* React root here (as
// any CM6 widget must - `toDOM()` hands back a bare DOM node, not JSX) needs
// no React Query/Router context bridged across the root boundary. The
// runtime ref supplies renderIcon/onNavigate fresh at click time without the
// widget needing to be reconstructed when those change.
export class RecordChipWidget extends WidgetType {
  private root: Root | null = null;

  constructor(
    private readonly result: CapitolRecordResolveResult,
    private readonly label: string,
    private readonly runtimeRef: RecordEditorRuntimeRef
  ) {
    super();
  }

  eq(other: RecordChipWidget): boolean {
    return this.label === other.label && resultsEqual(this.result, other.result);
  }

  toDOM(): HTMLElement {
    const container = document.createElement("span");
    container.className = "record-chip-widget";
    this.root = createRoot(container);
    this.root.render(
      createElement(RecordChip, {
        result: this.result,
        fallbackLabel: this.label,
        renderIcon: this.runtimeRef.current.renderIcon,
        onNavigate: this.runtimeRef.current.onNavigate,
        className: "record-chip",
      })
    );
    return container;
  }

  destroy(): void {
    // Deferred a tick: unmounting synchronously inside destroy() (itself
    // often called during CM6's own DOM update pass) can log React's
    // "unmount while rendering" warning for a widget being replaced by a
    // decoration rebuild in the same tick.
    const root = this.root;
    this.root = null;
    if (root) queueMicrotask(() => root.unmount());
  }

  ignoreEvent(): boolean {
    // The mounted <RecordChip> is a real, focusable anchor with its own
    // onClick (navigate) handler - let it handle its own events rather than
    // having CM6 try to place a cursor inside atomic, replaced content.
    return true;
  }
}
