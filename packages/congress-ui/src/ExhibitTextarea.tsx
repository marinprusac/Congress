import { forwardRef, useLayoutEffect, useRef, type ChangeEvent, type ReactNode } from "react";
import type { CapitolExhibitSearchResult } from "@congress/shared-types";
import { useExhibitPicker } from "./useExhibitPicker.js";
import { ExhibitPickerDropdown } from "./ExhibitPickerDropdown.js";

interface ExhibitTextareaProps {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  // Applied to the <textarea> itself - every call site still owns its exact
  // look (padding/margin varies slightly between forms), this component only
  // owns the [[ picker wiring and auto-resize behavior.
  className: string;
  wrapperClassName?: string;
  renderIcon: (chamber: string) => ReactNode;
  // Auto-grows with content by default - none of the call sites this
  // replaces had that, but a fixed `rows` on a field meant to hold a whole
  // note/description is exactly the kind of thing that should be a shared
  // feature once there's one shared component to put it in.
  autoResize?: boolean;
  // Lets "[[query" offer "+ Create query" when nothing matches, creating the
  // Exhibit inline and inserting a reference to it without leaving this
  // field - see useExhibitPicker's onCreate.
  onCreate?: (title: string) => Promise<CapitolExhibitSearchResult>;
}

// Static browser capability, not per-render state - checked once at module
// load. Where supported, the CSS `field-sizing: content` rule below
// (.exhibit-textarea-auto-resize in shared.css) auto-grows the textarea
// natively with no JS involved at all; the measuring effect further down
// only exists as a fallback for browsers that don't support it yet.
const supportsFieldSizingContent =
  typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("field-sizing", "content");

function mergeRefs<T>(refs: Array<React.Ref<T> | undefined>) {
  return (value: T | null) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === "function") ref(value);
      else (ref as React.MutableRefObject<T | null>).current = value;
    }
  };
}

// Every place a Chamber lets you write body text that can reference an
// Exhibit via "[[" - wraps useExhibitPicker + <textarea> + the picker's
// dropdown in one component instead of each page re-wiring the same three
// pieces (some previously skipped the picker entirely, e.g. Tasks).
export const ExhibitTextarea = forwardRef<HTMLTextAreaElement, ExhibitTextareaProps>(function ExhibitTextarea(
  {
    value,
    onChange,
    rows = 6,
    placeholder,
    className,
    wrapperClassName = "exhibit-field",
    renderIcon,
    autoResize = true,
    onCreate,
  },
  forwardedRef
) {
  const picker = useExhibitPicker({ value, onChange: (newValue) => onChange(newValue), onCreate });
  const elementRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    // The CSS rule already does this natively where supported - running the
    // JS path on top would fight it (this effect's own inline `style.height`
    // write beats the stylesheet rule, forcing a layout read/write pair on
    // every keystroke for nothing).
    if (!autoResize || supportsFieldSizingContent) return;
    const el = elementRef.current;
    if (!el) return;
    // Deferred to the next frame rather than measured synchronously inside
    // this layout effect, which otherwise forces an extra layout pass before
    // React can hand off to paint - on a textarea holding an entire note,
    // that's a full-document reflow blocking paint on every character typed.
    const frame = requestAnimationFrame(() => {
      const previousHeight = el.style.height;
      el.style.height = "auto";
      const nextHeight = `${el.scrollHeight}px`;
      // Skip the write (and the reflow/paint it would trigger) when nothing
      // actually changed - most keystrokes don't cross a wrapped-line
      // boundary.
      el.style.height = nextHeight === previousHeight ? previousHeight : nextHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [value, autoResize]);

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    onChange(e.target.value);
  }

  return (
    <div className={wrapperClassName}>
      <textarea
        {...picker.fieldProps}
        ref={mergeRefs([picker.fieldProps.ref, elementRef, forwardedRef])}
        value={value}
        onChange={handleChange}
        rows={rows}
        placeholder={placeholder}
        className={autoResize ? `${className} exhibit-textarea-auto-resize` : className}
      />
      <ExhibitPickerDropdown picker={picker} renderIcon={renderIcon} className="exhibit-picker-dropdown docked-sheet" />
    </div>
  );
});
