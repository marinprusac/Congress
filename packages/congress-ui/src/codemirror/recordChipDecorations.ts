import { EditorView, Decoration, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder, StateEffect, type Extension } from "@codemirror/state";
import { buildRecordToken, parseRecordToken } from "@congress/shared-types";
import { WIKILINK_PATTERN } from "../textSegments.js";
import { RecordChipWidget } from "./recordChipWidget.js";
import type { RecordEditorRuntimeRef } from "./runtime.js";

// Dispatched whenever `resultsByToken` settles with fresh data (a resolve
// query completing) so chip decorations get rebuilt even though the
// document itself didn't change - a ViewPlugin's `update()` only runs in
// response to a transaction, so this is a deliberate no-op transaction just
// to trigger that recompute.
export const refreshRecordChips = StateEffect.define<null>();

function buildChipDecorations(view: EditorView, runtimeRef: RecordEditorRuntimeRef): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc.toString();
  for (const match of doc.matchAll(WIKILINK_PATTERN)) {
    const target = match[1]?.trim();
    if (!target) continue;
    const parsed = parseRecordToken(target);
    if (!parsed) continue;
    const from = match.index ?? 0;
    const to = from + match[0]!.length;
    const token = buildRecordToken(parsed);
    const label = match[2]?.trim() || parsed.id;
    const result = runtimeRef.current.resultsByToken.get(token) ?? { ...parsed, unavailable: true as const };
    builder.add(from, to, Decoration.replace({ widget: new RecordChipWidget(result, label, runtimeRef) }));
  }
  return builder.finish();
}

// Every real record token in the doc becomes an atomic, non-editable chip -
// unconditionally, never revealed as raw text even with the cursor inside
// (a deliberate divergence from Obsidian's own link-reveals-on-focus
// convention, since the spec calls for chip codes to be "completely
// invisible": there's no "typing a chip character by character" state to
// worry about colliding with this, since a chip is only ever produced by
// picking a search result, never hand-typed).
export function createRecordChipExtensions(runtimeRef: RecordEditorRuntimeRef): Extension[] {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildChipDecorations(view, runtimeRef);
      }
      update(update: ViewUpdate) {
        const shouldRebuild =
          update.docChanged || update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshRecordChips)));
        this.decorations = shouldRebuild ? buildChipDecorations(update.view, runtimeRef) : this.decorations.map(update.changes);
      }
    },
    { decorations: (v) => v.decorations }
  );

  return [
    plugin,
    // Registers the same decoration set as atomic ranges - the caret and
    // Backspace/Delete then treat a whole chip as one unit instead of
    // stepping/deleting through its underlying bracket-token characters.
    EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
  ];
}
