import { forwardRef, useLayoutEffect, useRef, type ChangeEvent, type ReactNode } from "react";
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
}

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
  { value, onChange, rows = 6, placeholder, className, wrapperClassName = "exhibit-field", renderIcon, autoResize = true },
  forwardedRef
) {
  const picker = useExhibitPicker({ value, onChange: (newValue) => onChange(newValue) });
  const elementRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    if (!autoResize) return;
    const el = elementRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
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
        className={className}
      />
      <ExhibitPickerDropdown picker={picker} renderIcon={renderIcon} className="exhibit-picker-dropdown" />
    </div>
  );
});
