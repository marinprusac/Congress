import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ExerciseTemplate } from "../../../src/types";
import { fetchExerciseTemplates } from "@/lib/api";

// Purpose-specific to this Chamber's routine editor - no existing congress-ui
// combobox fits (ExhibitPickerDropdown is tightly coupled to CM6's caret
// positioning, PayloadFieldPicker inserts a token into a text field rather
// than picking a value), so this is a small new one. Reuses the .field-picker
// trigger+popover CSS idiom (mobile-fixed / desktop-anchored) already
// established for exactly this "small button opens a search popover" shape.
export function ExerciseTemplatePicker({ onSelect }: { onSelect: (template: ExerciseTemplate) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const templatesQuery = useQuery({
    queryKey: ["exercise-templates", query],
    queryFn: () => fetchExerciseTemplates(query),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  function select(template: ExerciseTemplate) {
    onSelect(template);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="field-picker" ref={wrapperRef}>
      <button type="button" className="tap-target border border-dust px-3 py-2 font-mono text-sm text-ink hover:border-accent" onClick={() => setOpen((o) => !o)}>
        + Add exercise
      </button>
      {open && (
        <div className="field-picker-popover">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search exercises —"
            className="border-b border-dust bg-parchment px-2 py-1.5 font-mono text-sm text-ink placeholder:text-dust focus:outline-none"
          />
          {templatesQuery.isLoading && <p className="px-2 py-1.5 font-mono text-sm text-dust">Loading —</p>}
          {templatesQuery.isError && <p className="px-2 py-1.5 font-mono text-sm text-alert">Failed to load exercises.</p>}
          {templatesQuery.data?.length === 0 && <p className="px-2 py-1.5 font-mono text-sm text-dust">— No matches —</p>}
          {templatesQuery.data?.map((template) => (
            <button key={template.id} type="button" className="field-picker-option" onClick={() => select(template)}>
              <span>{template.title}</span>
              {template.primaryMuscleGroup && <span className="field-picker-option-hint">{template.primaryMuscleGroup}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
