import { EditorView, Decoration, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

// Delimiter-mark node names (from @codemirror/lang-markdown's Lezer parse)
// hidden when the cursor isn't touching their enclosing node - this, plus
// the syntax-highlighting theme in theme.ts (which styles the *content* of
// those same nodes via standard highlight tags, not custom decorations),
// is the actual "Obsidian Live Preview" behavior: raw markdown syntax
// disappears until you click into it to edit, then reappears as plain
// source. ListMark ("-"/"1.") is deliberately never hidden - hiding a list's
// own bullet/number would make its structure ambiguous to read, and
// Obsidian keeps these visible too.
const MULTILINE_HIDDEN_MARKS = new Set(["HeaderMark", "EmphasisMark", "CodeMark", "QuoteMark", "LinkMark"]);
const INLINE_HIDDEN_MARKS = new Set(["EmphasisMark", "LinkMark"]);
// The URL segment of `[Label](https://...)` - hidden as a whole alongside
// its LinkMark parens, so a live-previewed link reads as just "Label".
const HIDDEN_NON_MARK_NODES = new Set(["URL"]);

function buildHiddenRanges(view: EditorView, mode: "multiline" | "inline"): DecorationSet {
  const hidden = mode === "multiline" ? MULTILINE_HIDDEN_MARKS : INLINE_HIDDEN_MARKS;
  const selection = view.state.selection.main;
  const ranges: { from: number; to: number }[] = [];

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (!hidden.has(node.name) && !HIDDEN_NON_MARK_NODES.has(node.name)) return;
        // Reveal the raw source for the node the mark belongs to, not just
        // the mark's own (often single-character) span - a cursor sitting
        // anywhere inside "**bold**" should reveal both "**"s, not just
        // whichever one it happens to be nearest.
        const parent = node.node.parent;
        const spanFrom = parent?.from ?? node.from;
        const spanTo = parent?.to ?? node.to;
        if (selection.from <= spanTo && selection.to >= spanFrom) return;
        ranges.push({ from: node.from, to: node.to });
      },
    });
  }

  ranges.sort((a, b) => a.from - b.from);
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of ranges) builder.add(range.from, range.to, Decoration.replace({}));
  return builder.finish();
}

export function createLivePreviewExtension(mode: "multiline" | "inline"): Extension[] {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildHiddenRanges(view, mode);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = buildHiddenRanges(update.view, mode);
        } else {
          this.decorations = this.decorations.map(update.changes);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );
  return [plugin];
}
