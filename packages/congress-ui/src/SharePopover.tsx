import { useEffect, useRef, type ReactNode } from "react";
import { useKeyboardInset } from "./useKeyboardInset.js";

interface SharePopoverProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

// The one menu both ShareControl's "Share" button and ExhibitSharingBadge's
// click open - deliberately just a menu (no dialog title bar, no explicit
// close button): dismissing it works the same way as the global search
// dropdown or the [[ picker, by clicking away or pressing Escape, not by
// hunting for an "x". Positioned by .share-control-popover, whose parent
// (.share-control, rendered by each trigger) supplies the anchor.
export function SharePopover({ open, onClose, children }: SharePopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const keyboardInset = useKeyboardInset();

  useEffect(() => {
    if (!open) return;
    function onOutsideDown(e: MouseEvent) {
      if (!(e.target instanceof Node) || ref.current?.parentElement?.contains(e.target)) return;
      onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onOutsideDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onOutsideDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      className="share-control-popover"
      style={keyboardInset > 0 ? { bottom: keyboardInset } : undefined}
    >
      {children}
    </div>
  );
}
