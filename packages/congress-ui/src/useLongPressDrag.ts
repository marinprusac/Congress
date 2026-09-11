import { useEffect, useRef, useState } from "react";

// How long a touch has to hold still before it's treated as "start a drag"
// rather than the beginning of an ordinary scroll - long enough that a
// normal scroll or tap never accidentally starts one. Mouse skips this
// entirely: a drag starts immediately on mousedown, since there's no scroll
// gesture on a trackpad/mouse to disambiguate from and no vibration to gate.
const LONG_PRESS_MS = 400;
// How far a touch can move before the long-press timer fires without
// cancelling it - a supplementary same-thread check for movement too small
// to make the browser itself commit to a native scroll (see `touchAction`
// below) but still too much to read as a held-still finger.
const MOVE_CANCEL_PX = 10;

export interface UseLongPressDragOptions {
  // Fires once a drag actually begins - immediately on mousedown, or after
  // the long-press fires (with a vibration) for touch/pen. The place to
  // capture whatever anchor state the caller's own onDragMove/onDragEnd
  // math needs (e.g. the value being dragged, before any delta is applied).
  onActivate?: (clientY: number) => void;
  // Fires on every pointermove while actively dragging, with the raw pixel
  // delta from the activation point (not an absolute position, and not
  // resolved against any caller-specific scale) - what a delta *means* (a
  // time shift, a reorder slot, anything else) is entirely up to the
  // caller.
  onDragMove: (deltaPx: number, clientY: number) => void;
  // Fires once, on release, with the final pixel delta.
  onDragEnd: (deltaPx: number) => void;
  // Fires if the drag is abandoned instead of released - a pointercancel,
  // Escape, or right-click while dragging.
  onDragCancel?: () => void;
  // Skips the long-press/drag machinery entirely (e.g. a read-only item) -
  // the pointerdown handler becomes a no-op rather than the caller needing
  // to conditionally attach it.
  disabled?: boolean;
}

export interface UseLongPressDragResult {
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  // The caller's pressed element must spread this into its own style prop.
  // touchAction is "pan-y" (not "none") while merely pending - so a genuine
  // scroll starting on a draggable element is still the browser's own
  // native, compositor-driven scroll, not something this hook has to
  // reimplement by hand. The browser fires pointercancel the moment it
  // commits to that native pan, which the pending-phase listener below
  // already treats as "cancel the long-press timer" - exactly the right
  // outcome, since a touch that actually moved enough to scroll was never a
  // held-still long-press to begin with. Only once a drag has actually
  // activated does this switch to "none", so the browser can't then steal a
  // mid-drag pointermove out from under onDragMove. The rest neutralizes the
  // browser's own native touch/drag gestures on a pressed <a> (or any
  // element) that would otherwise fire on the same long-press this hook is
  // trying to claim - iOS Safari's link-preview popup
  // (-webkit-touch-callout), the browser's native "drag this link out"
  // ghost/affordance (-webkit-user-drag), and incidental text selection
  // (userSelect) - same fix already proven for NavPanel's own draggable
  // links, see shared.css's .nav-panel-link.
  style: React.CSSProperties;
}

// Long-press-and-drag for touch (with a short vibration on activation),
// immediate drag-on-mousedown for mouse - the same gesture AgendaGapRow
// pioneered for picking a new-event time out of the Agenda's blank space,
// generalized here so any Chamber can reuse it for its own "pick this up
// and drag it" interaction (e.g. rescheduling an existing calendar event by
// dragging it to a new time). Deliberately hands back only a raw pixel
// delta from the activation point - never an absolute position, a resolved
// value, or anything that assumes a linear pixel-to-value mapping, since
// callers whose own rendered scale is non-linear (e.g. a sqrt-compressed
// time axis) still need a delta that scrubs at a constant, predictable rate.
export function useLongPressDrag(options: UseLongPressDragOptions): UseLongPressDragResult {
  const [dragging, setDragging] = useState(false);

  const onActivateRef = useRef(options.onActivate);
  onActivateRef.current = options.onActivate;
  const onDragMoveRef = useRef(options.onDragMove);
  onDragMoveRef.current = options.onDragMove;
  const onDragEndRef = useRef(options.onDragEnd);
  onDragEndRef.current = options.onDragEnd;
  const onDragCancelRef = useRef(options.onDragCancel);
  onDragCancelRef.current = options.onDragCancel;
  const disabledRef = useRef(options.disabled ?? false);
  disabledRef.current = options.disabled ?? false;

  const anchorClientYRef = useRef(0);
  const pointerTypeRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const startClientRef = useRef<{ x: number; y: number } | null>(null);
  const lastClientYRef = useRef(0);
  // Scopes the pending-phase window listeners to only the one pointer that
  // actually went down on this element - without it, a touch that started
  // on some *other* draggable element would still hit these handlers.
  const activePointerIdRef = useRef<number | null>(null);

  function clearTimer() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (disabledRef.current) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointerTypeRef.current = e.pointerType;
    activePointerIdRef.current = e.pointerId;
    startClientRef.current = { x: e.clientX, y: e.clientY };
    lastClientYRef.current = e.clientY;
    clearTimer();
    if (e.pointerType === "mouse") {
      anchorClientYRef.current = e.clientY;
      setDragging(true);
      onActivateRef.current?.(e.clientY);
    } else {
      timerRef.current = window.setTimeout(() => {
        anchorClientYRef.current = lastClientYRef.current;
        setDragging(true);
        navigator.vibrate?.(10);
        onActivateRef.current?.(lastClientYRef.current);
      }, LONG_PRESS_MS);
    }
  }

  useEffect(() => {
    if (!dragging) {
      function onMove(e: PointerEvent) {
        if (e.pointerId !== activePointerIdRef.current) return;
        lastClientYRef.current = e.clientY;
        if (!startClientRef.current || timerRef.current === null) return;
        const dx = e.clientX - startClientRef.current.x;
        const dy = e.clientY - startClientRef.current.y;
        if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) clearTimer();
      }
      function onUp(e: PointerEvent) {
        if (e.pointerId !== activePointerIdRef.current) return;
        clearTimer();
        startClientRef.current = null;
        activePointerIdRef.current = null;
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      return () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
    }

    function onMove(e: PointerEvent) {
      e.preventDefault();
      onDragMoveRef.current(e.clientY - anchorClientYRef.current, e.clientY);
    }
    function finish(e: PointerEvent) {
      const deltaPx = e.clientY - anchorClientYRef.current;
      setDragging(false);
      activePointerIdRef.current = null;
      onDragEndRef.current(deltaPx);
    }
    function onCancel() {
      setDragging(false);
      activePointerIdRef.current = null;
      onDragCancelRef.current?.();
    }
    function onContextMenu(e: MouseEvent) {
      e.preventDefault();
      onCancel();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  useEffect(() => clearTimer, []);

  return {
    dragging,
    onPointerDown,
    style: {
      touchAction: dragging ? "none" : "pan-y",
      userSelect: "none",
      WebkitUserSelect: "none",
      WebkitUserDrag: "none",
      WebkitTouchCallout: "none",
    } as React.CSSProperties,
  };
}
