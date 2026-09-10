import { useEffect, useRef, useState } from "react";

// How long a touch has to hold still before it's treated as "start a drag"
// rather than the beginning of an ordinary scroll - long enough that a
// normal scroll or tap never accidentally starts one. Mouse skips this
// entirely: a drag starts immediately on mousedown, since there's no scroll
// gesture on a trackpad/mouse to disambiguate from and no vibration to gate.
const LONG_PRESS_MS = 400;
// How far a touch can move before the long-press timer fires without
// cancelling it - past this while still waiting reads as a scroll, not a
// held finger, so the timer is dropped. touchAction: "none" on the pressed
// element (the caller's responsibility - see the returned `touchAction`
// value) means the browser never starts a native scroll on its own here -
// without it, a native scroll beginning mid-hold fires pointercancel and
// silently kills the long-press timer before it ever gets a chance to fire,
// which is exactly what made long-press-and-drag flaky on a phone. Once
// dropped, onMove below drives window.scrollBy itself (batched to once per
// animation frame - see queueScrollBy) for the rest of this touch so an
// ordinary swipe still scrolls the page; startMomentum then picks up where
// the native fling would have on release.
const MOVE_CANCEL_PX = 10;

// Because touch-action: none keeps the browser from ever seeing the pressed
// element as scrollable, an ordinary swipe that starts on it never gets
// native momentum - the pending-phase onMove above already covers the 1:1
// scroll while the finger is down, but release used to just stop dead.
// These constants reimplement that missing momentum by hand: an
// exponential-decay fling driven by the touch's own recent velocity,
// restarted every animation frame until it decays below
// MOMENTUM_MIN_VELOCITY or gets interrupted. MOMENTUM_FRICTION is expressed
// per-ms (not per-frame) so the decay rate doesn't depend on the display's
// refresh rate; ~0.9968 matches the common "0.95 per 16ms frame"
// convention. MOMENTUM_STALE_MS guards the case where the finger stopped
// moving and just sat there before lifting - without it, a fast swipe that
// paused before release would still be read as a flick.
const MOMENTUM_FRICTION_PER_MS = 0.9968;
const MOMENTUM_MIN_VELOCITY = 0.02; // px/ms; below this the fling is imperceptible, so stop
const MOMENTUM_MAX_VELOCITY = 5; // px/ms; clamps a noisy single-sample velocity spike
const MOMENTUM_STALE_MS = 60;

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
  // The caller's pressed element must set this as its own touchAction style
  // - see MOVE_CANCEL_PX above for why.
  touchAction: "none";
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
  const scrollDeltaRef = useRef(0);
  const scrollRafRef = useRef<number | null>(null);
  const velocityRef = useRef(0);
  const lastMoveTimeRef = useRef(0);
  const wasManualScrollRef = useRef(false);
  const momentumRafRef = useRef<number | null>(null);
  const momentumCleanupRef = useRef<(() => void) | null>(null);

  function cancelPendingScroll() {
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
    scrollDeltaRef.current = 0;
  }

  function cancelMomentum() {
    if (momentumRafRef.current !== null) {
      cancelAnimationFrame(momentumRafRef.current);
      momentumRafRef.current = null;
    }
    momentumCleanupRef.current?.();
    momentumCleanupRef.current = null;
  }

  function startMomentum(releaseTimeStamp: number) {
    const stale = releaseTimeStamp - lastMoveTimeRef.current > MOMENTUM_STALE_MS;
    let velocity = stale ? 0 : velocityRef.current;
    velocity = Math.max(-MOMENTUM_MAX_VELOCITY, Math.min(MOMENTUM_MAX_VELOCITY, velocity));
    if (Math.abs(velocity) < MOMENTUM_MIN_VELOCITY) return;

    function stop() {
      cancelMomentum();
    }
    window.addEventListener("pointerdown", stop, { once: true });
    window.addEventListener("wheel", stop, { once: true });
    momentumCleanupRef.current = () => {
      window.removeEventListener("pointerdown", stop);
      window.removeEventListener("wheel", stop);
    };

    let lastTs: number | null = null;
    function step(ts: number) {
      if (lastTs === null) {
        lastTs = ts;
        momentumRafRef.current = requestAnimationFrame(step);
        return;
      }
      const dt = ts - lastTs;
      lastTs = ts;
      velocity *= Math.pow(MOMENTUM_FRICTION_PER_MS, dt);
      window.scrollBy(0, velocity * dt);
      if (Math.abs(velocity) < MOMENTUM_MIN_VELOCITY) {
        cancelMomentum();
        return;
      }
      momentumRafRef.current = requestAnimationFrame(step);
    }
    momentumRafRef.current = requestAnimationFrame(step);
  }

  function queueScrollBy(deltaY: number) {
    scrollDeltaRef.current += deltaY;
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const delta = scrollDeltaRef.current;
      scrollDeltaRef.current = 0;
      if (delta !== 0) window.scrollBy(0, delta);
    });
  }

  function clearTimer() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (disabledRef.current) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    cancelMomentum();
    pointerTypeRef.current = e.pointerType;
    activePointerIdRef.current = e.pointerId;
    startClientRef.current = { x: e.clientX, y: e.clientY };
    lastClientYRef.current = e.clientY;
    lastMoveTimeRef.current = e.timeStamp;
    velocityRef.current = 0;
    wasManualScrollRef.current = false;
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
        const prevClientY = lastClientYRef.current;
        lastClientYRef.current = e.clientY;
        if (pointerTypeRef.current !== "mouse") {
          queueScrollBy(prevClientY - e.clientY);
          const dt = e.timeStamp - lastMoveTimeRef.current;
          if (dt > 0) velocityRef.current = (prevClientY - e.clientY) / dt;
          lastMoveTimeRef.current = e.timeStamp;
        }
        if (!startClientRef.current || timerRef.current === null) return;
        const dx = e.clientX - startClientRef.current.x;
        const dy = e.clientY - startClientRef.current.y;
        if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
          wasManualScrollRef.current = true;
          clearTimer();
        }
      }
      function onUp(e: PointerEvent) {
        if (e.pointerId !== activePointerIdRef.current) return;
        clearTimer();
        startClientRef.current = null;
        activePointerIdRef.current = null;
        cancelPendingScroll();
        if (pointerTypeRef.current !== "mouse" && wasManualScrollRef.current) startMomentum(e.timeStamp);
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      return () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        cancelPendingScroll();
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

  useEffect(
    () => () => {
      clearTimer();
      cancelPendingScroll();
      cancelMomentum();
    },
    []
  );

  return { dragging, onPointerDown, touchAction: "none" };
}
