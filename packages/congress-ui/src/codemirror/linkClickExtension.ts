import { EditorView } from "@codemirror/view";
import type { EditorState, Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";

const EXTERNAL_URL = /^https?:\/\//i;

// Normalises the raw text of a Lezer `URL` node - `<https://x>` autolinks keep
// their angle brackets in the node - and rejects anything that isn't http(s),
// so a `javascript:` link can never be opened from here.
export function externalUrlFromText(raw: string): string | null {
  const url = raw.trim().replace(/^<|>$/g, "");
  return EXTERNAL_URL.test(url) ? url : null;
}

// The external URL of the Link/Autolink covering `pos`, or null.
export function externalLinkUrlAt(state: EditorState, pos: number): string | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    // A bare https://... (lezer's Autolink extension) is a lone URL node; the
    // [label](url) and <url> forms wrap theirs in Link/Autolink.
    if (node.name === "URL") return externalUrlFromText(state.sliceDoc(node.from, node.to));
    if (node.name !== "Link" && node.name !== "Autolink") continue;
    const urlNode = node.getChild("URL");
    return urlNode ? externalUrlFromText(state.sliceDoc(urlNode.from, urlNode.to)) : null;
  }
  return null;
}

// Ctrl/Cmd+click on a link opens it in a new tab; a plain click still just
// places the caret (which is how a link is edited). Handled on mousedown so
// CodeMirror doesn't also start a selection.
export function createLinkClickExtension(): Extension {
  return [
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (event.button !== 0 || !(event.ctrlKey || event.metaKey)) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        const url = externalLinkUrlAt(view.state, pos);
        if (!url) return false;
        event.preventDefault();
        window.open(url, "_blank", "noopener,noreferrer");
        return true;
      },
    }),
  ];
}
