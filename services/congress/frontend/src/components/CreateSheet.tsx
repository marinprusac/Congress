import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChamberMark, fetchRegistry, resolveChamberPath, usePresence, useStackNav } from "@congress/congress-ui";

// The "+" sheet: every kind of Exhibit the active Chambers let the owner
// create (manifest.exhibitTypes). Picking one opens that Chamber's own
// editor on a new, unsaved Exhibit - the Chamber still owns creation.
export function CreateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useStackNav();
  const { mounted, state } = usePresence(open);
  const { data: registry } = useQuery({ queryKey: ["congress", "registry"], queryFn: fetchRegistry });

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!mounted) return null;

  const options = (registry ?? [])
    .filter((c) => c.status === "active")
    .flatMap((c) => (c.exhibitTypes ?? []).map((t) => ({ chamber: c.name, ...t })));

  return (
    <>
      <div className="create-sheet-backdrop" data-state={state} onClick={onClose} aria-hidden="true" />
      <div className="create-sheet" data-state={state} role="dialog" aria-label="Create">
        <div className="create-sheet-title">New —</div>
        {options.length === 0 && <p className="p-4 font-mono text-xs text-dust">No Chamber offers anything to create right now.</p>}
        {options.map((option) => (
          <button
            key={`${option.chamber}:${option.type}`}
            type="button"
            className="create-sheet-option"
            onClick={() => {
              onClose();
              nav.push(resolveChamberPath(option.createPath, option.chamber, true));
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
