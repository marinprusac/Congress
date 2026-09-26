import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChamberMark, fetchRegistry, resolveChamberPath } from "@congress/congress-ui";

// The "+" sheet: every kind of Exhibit the active Chambers let the owner
// create (manifest.exhibitTypes). Picking one opens that Chamber's own
// editor on a new, unsaved Exhibit - the Chamber still owns creation.
export function CreateSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { data: registry } = useQuery({ queryKey: ["congress", "registry"], queryFn: fetchRegistry });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const options = (registry ?? [])
    .filter((c) => c.status === "active")
    .flatMap((c) => (c.exhibitTypes ?? []).map((t) => ({ chamber: c.name, ...t })));

  return (
    <>
      <div className="create-sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="create-sheet" role="dialog" aria-label="Create">
        <div className="create-sheet-title">New —</div>
        {options.length === 0 && <p className="p-4 font-mono text-xs text-dust">No Chamber offers anything to create right now.</p>}
        {options.map((option) => (
          <button
            key={`${option.chamber}:${option.type}`}
            type="button"
            className="create-sheet-option"
            onClick={() => {
              onClose();
              navigate(resolveChamberPath(option.createPath, option.chamber, true));
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
