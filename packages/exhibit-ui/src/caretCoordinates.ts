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

export function getCaretCoordinates(element: HTMLTextAreaElement, index: number): { top: number; left: number } {
  const div = document.createElement("div");
  const style = window.getComputedStyle(element);

  for (const prop of MIRRORED_PROPERTIES) {
    (div.style as unknown as Record<string, string>)[prop] = (style as unknown as Record<string, string>)[prop] ?? "";
  }
  div.style.position = "absolute";
  div.style.visibility = "hidden";
  div.style.whiteSpace = "pre-wrap";
  div.style.wordWrap = "break-word";
  div.style.top = "0";
  div.style.left = "-9999px";
  div.style.height = "auto";
  div.style.overflow = "hidden";

  document.body.appendChild(div);

  div.textContent = element.value.slice(0, index);
  // A trailing newline needs an explicit space to take a new line inside a
  // div - a <textarea> gives it one for free, a div otherwise collapses it.
  if (element.value[index - 1] === "\n") div.textContent += " ";

  const span = document.createElement("span");
  span.textContent = element.value.slice(index) || ".";
  div.appendChild(span);

  const coordinates = {
    top: span.offsetTop - element.scrollTop,
    left: span.offsetLeft - element.scrollLeft,
  };

  document.body.removeChild(div);
  return coordinates;
}
