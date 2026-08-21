// Computes the pixel position of a character index within a <textarea>,
// relative to the textarea's own top-left corner. Used to anchor the [[
// picker dropdown next to the caret rather than at the bottom of the field -
// a field that auto-resizes to its full content can be many screens tall,
// so "below the field" and "below the caret" are very different places.
//
// Standard mirror-div technique: a hidden div styled identically to the
// textarea (same font/box metrics) holds the text up to the index, with a
// marker span at the end whose layout offset gives the caret's position -
// there's no DOM API that exposes this directly for a plain <textarea>.
const MIRRORED_PROPERTIES = [
  "boxSizing",
  "width",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "lineHeight",
  "textTransform",
  "textIndent",
  "textAlign",
  "whiteSpace",
  "wordSpacing",
  "tabSize",
] as const;

// One mirror div, reused across every call (and every textarea) instead of
// created/styled/appended/removed each time - useExhibitPicker only calls
// this when the "[[" anchor itself moves now, not on every keystroke, but
// building a fresh element and copying ~20 computed style properties onto
// it is still needless work to repeat when the div and (usually) the
// element being measured haven't changed since the last call.
let mirror: HTMLDivElement | null = null;
let leadingText: Text | null = null;
let marker: HTMLSpanElement | null = null;
let styledFor: HTMLTextAreaElement | null = null;

function ensureMirror(element: HTMLTextAreaElement): { leadingText: Text; marker: HTMLSpanElement } {
  if (!mirror || !leadingText || !marker) {
    mirror = document.createElement("div");
    mirror.style.position = "absolute";
    mirror.style.visibility = "hidden";
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.wordWrap = "break-word";
    mirror.style.top = "0";
    mirror.style.left = "-9999px";
    mirror.style.height = "auto";
    mirror.style.overflow = "hidden";
    leadingText = document.createTextNode("");
    marker = document.createElement("span");
    mirror.append(leadingText, marker);
    document.body.appendChild(mirror);
    styledFor = null;
  }
  if (styledFor !== element) {
    const style = window.getComputedStyle(element);
    for (const prop of MIRRORED_PROPERTIES) {
      (mirror.style as unknown as Record<string, string>)[prop] = (style as unknown as Record<string, string>)[prop] ?? "";
    }
    styledFor = element;
  }
  return { leadingText, marker };
}

export function getCaretCoordinates(element: HTMLTextAreaElement, index: number): { top: number; left: number } {
  const { leadingText: lead, marker: span } = ensureMirror(element);

  let text = element.value.slice(0, index);
  // A trailing newline needs an explicit space to take a new line inside a
  // div - a <textarea> gives it one for free, a div otherwise collapses it.
  if (element.value[index - 1] === "\n") text += " ";
  lead.textContent = text;
  // Only the marker span's own start position matters (offsetTop/offsetLeft
  // below) - its content just needs to be non-empty, not the rest of the
  // note. The old version put the whole remaining tail in here, forcing a
  // layout pass over a duplicate of the note's own largest text node on
  // every measurement.
  span.textContent = ".";

  return {
    top: span.offsetTop - element.scrollTop,
    left: span.offsetLeft - element.scrollLeft,
  };
}
