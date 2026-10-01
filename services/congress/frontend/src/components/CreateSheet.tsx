import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChamberMark, usePresence, useStackNav } from "@congress/congress-ui";
import { canCreate, CUSTOM_NEW, fetchTypes } from "@/lib/recordsApi";
import { TYPES_KEY } from "@/records/RecordPage";

// The "+" sheet: every kind of record the owner can create by hand; picking
// one opens its editor on a new, unsaved record.
export function CreateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useStackNav();
  const { mounted, state } = usePresence(open);
  const { data: types } = useQuery({ queryKey: TYPES_KEY, queryFn: fetchTypes });

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!mounted) return null;

  const options = (types ?? [])
    .filter((t) => !t.definition.hidden && (canCreate(t.definition) || CUSTOM_NEW.has(t.definition.slug)))
    .map((t) => ({ chamber: "e", type: t.definition.slug, label: t.definition.label, path: `/e/new/${t.definition.slug}` }));

  return (
    <>
      <div className="create-sheet-backdrop" data-state={state} onClick={onClose} aria-hidden="true" />
      <div className="create-sheet" data-state={state} role="dialog" aria-label="Create">
        <div className="create-sheet-title">New —</div>
        {options.length === 0 && <p className="p-4 font-mono text-xs text-dust">Nothing to create right now.</p>}
        {options.map((option) => (
          <button
            key={`${option.chamber}:${option.type}`}
            type="button"
            className="create-sheet-option"
            onClick={() => {
              onClose();
              nav.push(option.path);
            }}
          >
            <ChamberMark name={option.chamber} />
            {option.label}
          </button>
        ))}
      </div>
    </>
  );
}
