import { EditorView, ViewPlugin, keymap, type ViewUpdate } from "@codemirror/view";
import { Prec, type Extension } from "@codemirror/state";
import { detectExhibitTrigger } from "../exhibitTrigger.js";

export interface ExhibitTriggerReport {
  triggerStart: number;
  query: string;
  cursor: number;
}

// Imperative controller the trigger keymap calls into - built once by
// useExhibitEditorCore and mutated in place every render (never replaced),
// so the keymap (itself built once at editor-mount time) always reaches the
// latest picker state/actions without the extension needing to be rebuilt.
export interface ExhibitPickerController {
  isOpen(): boolean;
  onEscape(): void;
  onArrowDown(): void;
  onArrowUp(): void;
  onSelectActive(): void;
}

// Detects a live "@" trigger and reports it upward, plus the Escape/Up/Down/
// Tab/Enter keymap for driving the resulting dropdown - split from the
// dropdown's search/selection state itself (owned by React, in
// useExhibitEditorCore) since only the trigger *detection* needs direct
// access to CM6's own document/selection.
export function createExhibitTriggerExtension(options: {
  enabled: boolean;
  onTriggerChange: (report: ExhibitTriggerReport | null) => void;
  controller: ExhibitPickerController;
}): Extension[] {
  if (!options.enabled) return [];

  const triggerWatcher = ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        this.report(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet) this.report(update.view);
      }
      report(view: EditorView) {
        const selection = view.state.selection.main;
        if (!selection.empty) {
          options.onTriggerChange(null);
          return;
        }
        const cursor = selection.head;
        const match = detectExhibitTrigger(view.state.doc.toString(), cursor);
        if (!match) {
          options.onTriggerChange(null);
          return;
        }
        // Deliberately no view.coordsAtPos() here - CM6 forbids reading
        // layout synchronously inside a ViewPlugin's update() (it throws
        // "Reading the editor layout isn't allowed during an update" and
        // silently disables the whole plugin). The dropdown's anchor
        // position is measured separately, outside CM6's update cycle, by
        // useExhibitEditorCore's own effect once React commits this report.
        options.onTriggerChange({ triggerStart: match.triggerStart, query: match.query, cursor });
      }
    }
  );

  // Prec.highest so these win over CM6's own default Escape/Enter/Tab
  // bindings, but only while a trigger is actually open (`run` returns
  // `false` otherwise, letting the event fall through to whatever would
  // normally handle it - a closed picker must not eat every Enter/Tab
  // keystroke in the field).
  const triggerKeymap = Prec.highest(
    keymap.of([
      { key: "Escape", run: () => guarded(options.controller, (c) => c.onEscape()) },
      { key: "ArrowDown", run: () => guarded(options.controller, (c) => c.onArrowDown()) },
      { key: "ArrowUp", run: () => guarded(options.controller, (c) => c.onArrowUp()) },
      { key: "Tab", run: () => guarded(options.controller, (c) => c.onSelectActive()) },
      { key: "Enter", run: () => guarded(options.controller, (c) => c.onSelectActive()) },
    ])
  );

  return [triggerWatcher, triggerKeymap];
}

function guarded(controller: ExhibitPickerController, run: (controller: ExhibitPickerController) => void): boolean {
  if (!controller.isOpen()) return false;
  run(controller);
  return true;
}
