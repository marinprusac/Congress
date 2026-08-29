import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WidgetType } from "@codemirror/view";
import type { CapitolExhibitResolveResult } from "@congress/shared-types";
import { ExhibitChip } from "../ExhibitChip.js";
import type { ExhibitEditorRuntimeRef } from "./runtime.js";

function resultsEqual(a: CapitolExhibitResolveResult, b: CapitolExhibitResolveResult): boolean {
  if (a.id !== b.id || a.chamber !== b.chamber) return false;
  if ("deleted" in a || "deleted" in b) return "deleted" in a && "deleted" in b;
  if ("unavailable" in a || "unavailable" in b) return "unavailable" in a && "unavailable" in b;
  return a.name === b.name && a.url === b.url;
}

// Replaces a `[[exhibit:chamber:id|Label]]` span in the document with a
// mounted <ExhibitChip> - this, plus registering the same range via
// EditorView.atomicRanges (see exhibitChipDecorations.ts), is what makes an
// exhibit reference genuinely invisible-as-code rather than merely styled:
// the caret and Backspace treat the whole widget as one unit, and the raw
// bracket-token text never renders at all, in edit or read-only mode alike.
//
// ExhibitChip itself takes an already-resolved `result` prop and does no
// fetching of its own, so mounting it into a *separate* React root here (as
// any CM6 widget must - `toDOM()` hands back a bare DOM node, not JSX) needs
// no React Query/Router context bridged across the root boundary. The
// runtime ref supplies renderIcon/onNavigate fresh at click time without the
// widget needing to be reconstructed when those change.
export class ExhibitChipWidget extends WidgetType {
  private root: Root | null = null;

  constructor(
    private readonly result: CapitolExhibitResolveResult,
    private readonly label: string,
    private readonly runtimeRef: ExhibitEditorRuntimeRef
  ) {
    super();
  }

  eq(other: ExhibitChipWidget): boolean {
    return this.label === other.label && resultsEqual(this.result, other.result);
  }

  toDOM(): HTMLElement {
    const container = document.createElement("span");
    container.className = "exhibit-chip-widget";
    this.root = createRoot(container);
    this.root.render(
      createElement(ExhibitChip, {
        result: this.result,
        fallbackLabel: this.label,
        renderIcon: this.runtimeRef.current.renderIcon,
        onNavigate: this.runtimeRef.current.onNavigate,
        className: "exhibit-chip",
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
    // The mounted <ExhibitChip> is a real, focusable anchor with its own
    // onClick (navigate) handler - let it handle its own events rather than
    // having CM6 try to place a cursor inside atomic, replaced content.
    return true;
  }
}
