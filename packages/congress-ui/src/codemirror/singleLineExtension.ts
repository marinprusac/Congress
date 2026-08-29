import { keymap } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";

// For the single-line/inline field variant (e.g. Calendar's location) -
// Enter fires the caller's own `onEnter` (e.g. submitting the form) instead
// of inserting a line break, and any newline that reaches the document any
// other way (paste, IME) drops that whole transaction rather than trying to
// surgically strip just the newline characters out of an arbitrary edit.
export function createSingleLineExtension(onEnter: () => void): Extension[] {
  return [
    EditorState.transactionFilter.of((tr) => {
      if (!tr.docChanged) return tr;
      let hasNewline = false;
      tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
        if (inserted.toString().includes("\n")) hasNewline = true;
      });
      return hasNewline ? [] : tr;
    }),
    // Placed ahead of @codemirror/commands' defaultKeymap in the extensions
    // array (see useExhibitEditorCore) so this wins at the same precedence
    // level; the exhibit-picker's own Enter binding is Prec.highest and so
    // still takes priority over this while the picker is open.
    keymap.of([{ key: "Enter", run: () => { onEnter(); return true; } }]),
  ];
}
