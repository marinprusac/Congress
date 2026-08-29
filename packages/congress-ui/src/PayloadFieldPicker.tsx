import { useEffect, useRef, useState, type RefObject } from "react";
import type { ManifestEventField } from "@congress/shared-types";

interface PayloadFieldPickerProps {
  // An event type's declared payload shape (ManifestEvent.payloadFields, or
  // its cached copy off chamber-logs' event_settings / chamber-automation's
  // live event catalog fetch) - null/undefined (no event selected, or that
  // event type declared no fields) hides the trigger entirely rather than
  // rendering an empty picker.
  fields: Record<string, ManifestEventField> | null | undefined;
  // The templated <input>/<textarea> this picker inserts into - a plain DOM
  // ref, not react-controlled cursor state, since selectionStart/End only
  // exist on the element itself.
  targetRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
  label?: string;
}

interface FieldOption {
  path: string;
  hint: string;
}

// Flat schema only (matches ArgsEditor's own restraint on the tool-argument
// side): an array field offers its whole-value token plus two derived
// paths - `.length` (a count, e.g. for "3 errors" in a title) and `.0` (one
// element, when the caller only cares about e.g. the most recent item).
// Nothing here iterates/joins all elements - that stays out of scope, same
// as the rest of this system's no-expression-language stance.
function optionsFor(fields: Record<string, ManifestEventField>): FieldOption[] {
  const options: FieldOption[] = [];
  for (const [name, field] of Object.entries(fields)) {
    options.push({ path: name, hint: field.type ?? "" });
    if (field.type === "array") {
      options.push({ path: `${name}.length`, hint: "count" });
      options.push({ path: `${name}.0`, hint: field.items?.type ? `first · ${field.items.type}` : "first item" });
    }
  }
  return options;
}

// A small "insert a known {{payload.x}} path" trigger for the notify-
// template inputs (chamber-logs) and automation arg-template inputs
// (chamber-automation) - both are plain text fields whose runtime behavior
// (interpolate()/buildArgs() in chamber-kit) doesn't change at all; this is
// purely an authoring assist so the owner picks a known field instead of
// typing a path they have to already know from reading source.
export function PayloadFieldPicker({ fields, targetRef, value, onChange, label = "Insert field" }: PayloadFieldPickerProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const options = fields ? optionsFor(fields) : [];

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  if (options.length === 0) return null;

  function insert(path: string) {
    const el = targetRef.current;
    const token = `{{payload.${path}}}`;
    // selectionStart/End survive the field losing focus to this button
    // click, so this still lands at the caret the owner was last at rather
    // than always appending to the end.
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => {
      const cursor = start + token.length;
      el?.focus();
      el?.setSelectionRange(cursor, cursor);
    });
  }

  return (
    <div className="field-picker" ref={wrapperRef}>
      <button
        type="button"
        className="field-picker-trigger tap-target"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        title={label}
      >
        {"{ }"}
      </button>
      {open && (
        <div className="field-picker-popover docked-sheet">
          {options.map((opt) => (
            <button key={opt.path} type="button" className="field-picker-option" onClick={() => insert(opt.path)}>
              <span className="field-picker-option-path">payload.{opt.path}</span>
              {opt.hint && <span className="field-picker-option-hint">{opt.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
