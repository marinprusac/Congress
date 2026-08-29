import { EditorView, Decoration, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder, StateEffect, type Extension } from "@codemirror/state";
import { buildExhibitToken, parseExhibitToken } from "@congress/shared-types";
import { WIKILINK_PATTERN } from "../textSegments.js";
import { ExhibitChipWidget } from "./exhibitChipWidget.js";
import type { ExhibitEditorRuntimeRef } from "./runtime.js";

// Dispatched whenever `resultsByToken` settles with fresh data (a resolve
// query completing) so chip decorations get rebuilt even though the
// document itself didn't change - a ViewPlugin's `update()` only runs in
// response to a transaction, so this is a deliberate no-op transaction just
// to trigger that recompute.
export const refreshExhibitChips = StateEffect.define<null>();

function buildChipDecorations(view: EditorView, runtimeRef: ExhibitEditorRuntimeRef): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc.toString();
  for (const match of doc.matchAll(WIKILINK_PATTERN)) {
    const target = match[1]?.trim();
    if (!target) continue;
    const parsed = parseExhibitToken(target);
    if (!parsed) continue;
    const from = match.index ?? 0;
    const to = from + match[0]!.length;
    const token = buildExhibitToken(parsed);
    const label = match[2]?.trim() || parsed.id;
    const result = runtimeRef.current.resultsByToken.get(token) ?? { ...parsed, unavailable: true as const };
    builder.add(from, to, Decoration.replace({ widget: new ExhibitChipWidget(result, label, runtimeRef) }));
  }
  return builder.finish();
}

// Every real exhibit token in the doc becomes an atomic, non-editable chip -
// unconditionally, never revealed as raw text even with the cursor inside
// (a deliberate divergence from Obsidian's own link-reveals-on-focus
// convention, since the spec calls for chip codes to be "completely
// invisible": there's no "typing a chip character by character" state to
// worry about colliding with this, since a chip is only ever produced by
// picking a search result, never hand-typed).
export function createExhibitChipExtensions(runtimeRef: ExhibitEditorRuntimeRef): Extension[] {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildChipDecorations(view, runtimeRef);
      }
      update(update: ViewUpdate) {
        const shouldRebuild =
          update.docChanged || update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshExhibitChips)));
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
