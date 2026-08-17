import { useEffect } from "react";

export interface ConfirmSheetProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

// Native-feeling stand-in for window.confirm() (which renders as unstyled
// OS chrome, jarring inside a standalone PWA) - a docked bottom sheet on
// mobile (same idiom as SharePopover/ExhibitPickerDropdown), a centered
// card with a backdrop on desktop, since a confirm alert has no trigger
// element of its own to anchor a dropdown to.
export function ConfirmSheet({ open, title, message, confirmLabel = "Delete", onConfirm, onCancel }: ConfirmSheetProps) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="confirm-sheet-backdrop" onClick={onCancel}>
      <div
        className="confirm-sheet docked-sheet"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-sheet-title"
        aria-describedby="confirm-sheet-message"
        onClick={(e) => e.stopPropagation()}
      >
        <p id="confirm-sheet-title" className="confirm-sheet-title">
          {title}
        </p>
        <p id="confirm-sheet-message" className="confirm-sheet-message">
          {message}
        </p>
        <div className="confirm-sheet-actions">
          <button type="button" onClick={onCancel} className="tap-target confirm-sheet-cancel">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} autoFocus className="tap-target confirm-sheet-confirm">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
