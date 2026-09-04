import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

// Built from congress-ui's existing semantic CSS custom properties (see
// shared.css) rather than hardcoded colors, so dark mode (useAppliedTheme)
// keeps working here with zero extra wiring - those tokens already flip
// per-theme wherever they're defined.
export const exhibitEditorTheme = EditorView.theme({
  "&": {
    color: "var(--color-ink)",
    backgroundColor: "transparent",
  },
  ".cm-content": {
    padding: 0,
    caretColor: "var(--color-ink)",
    fontFamily: "inherit",
    fontSize: "inherit",
    lineHeight: "inherit",
  },
  ".cm-line": { padding: 0 },
  "&.cm-focused": { outline: "none" },
  ".cm-placeholder": { color: "var(--color-dust)" },
  ".cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 20%, transparent) !important",
  },
});

// Feather/Lucide's "external-link" glyph (box with an arrow escaping its
// top-right corner) - the icon this convention normally uses. Applied as a
// mask rather than an inlined <svg> (there's no DOM node here to attach one
// to - this whole file only produces CSS for syntax-highlighted text spans)
// so its color can still track the accent-adjacent slate token/dark mode via
// background-color, the same way a real <img>/<svg> icon would via
// currentColor - a mask only cares about the source's alpha, not its color.
const EXTERNAL_LINK_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'/%3E%3Cpolyline points='15 3 21 3 21 9'/%3E%3Cline x1='10' y1='14' x2='21' y2='3'/%3E%3C/svg%3E";

// Content styling for the delimiter-hiding live-preview extension - the
// delimiters themselves (e.g. "**", "#") are hidden by livePreviewExtension,
// this just styles what's left (the actual heading/bold/link text).
export const markdownHighlightStyle: Extension = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.heading1, fontFamily: "var(--font-display)", fontWeight: "700", fontSize: "1.6em" },
    { tag: tags.heading2, fontFamily: "var(--font-display)", fontWeight: "700", fontSize: "1.4em" },
    { tag: tags.heading3, fontFamily: "var(--font-display)", fontWeight: "700", fontSize: "1.2em" },
    { tag: tags.heading4, fontFamily: "var(--font-display)", fontWeight: "700" },
    { tag: [tags.heading5, tags.heading6], fontFamily: "var(--font-display)", fontWeight: "700", color: "var(--color-slate)" },
    { tag: tags.strong, fontWeight: "700" },
    { tag: tags.emphasis, fontStyle: "italic" },
    {
      tag: tags.link,
      color: "var(--color-accent)",
      textDecoration: "none",
      "&::before": {
        content: '""',
        display: "inline-block",
        width: "0.7em",
        height: "0.7em",
        marginRight: "0.3em",
        verticalAlign: "text-bottom",
        backgroundColor: "var(--color-slate)",
        maskImage: `url("${EXTERNAL_LINK_ICON}")`,
        maskSize: "contain",
        maskRepeat: "no-repeat",
        WebkitMaskImage: `url("${EXTERNAL_LINK_ICON}")`,
        WebkitMaskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
      },
    },
    {
      tag: tags.monospace,
      fontFamily: "var(--font-mono)",
      backgroundColor: "color-mix(in srgb, var(--color-dust) 15%, transparent)",
    },
    { tag: tags.quote, color: "var(--color-slate)", fontStyle: "italic" },
    { tag: tags.list, color: "var(--color-slate)" },
  ])
);
