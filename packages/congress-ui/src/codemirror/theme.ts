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
    { tag: tags.link, color: "var(--color-accent)", textDecoration: "underline" },
    {
      tag: tags.monospace,
      fontFamily: "var(--font-mono)",
      backgroundColor: "color-mix(in srgb, var(--color-dust) 15%, transparent)",
    },
    { tag: tags.quote, color: "var(--color-slate)", fontStyle: "italic" },
    { tag: tags.list, color: "var(--color-slate)" },
  ])
);
