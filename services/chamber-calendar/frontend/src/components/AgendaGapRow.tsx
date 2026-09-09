import { useEffect, useRef, useState } from "react";
import { fineTimeFromDelta, formatClockTime, formatGapDuration, gapHeightPx, snapToHalfHour } from "@/lib/datetime";
import type { AgendaGapEntry } from "@/lib/datetime";

// Below this, a gap's blank space stays unlabeled - long enough to be worth
// naming, but a 5-minute breather between back-to-back meetings doesn't
// need its own caption.
const GAP_LABEL_THRESHOLD_MINUTES = 20;

// How long a touch has to hold still before it's treated as "start picking a
// time here" rather than the beginning of an ordinary scroll - long enough
// that a normal scroll or tap never accidentally opens the create-event
// flow. Mouse skips this entirely: hovering already previews a line with
// nothing pressed, so there's no scroll gesture to disambiguate from.
const LONG_PRESS_MS = 400;
// How far a touch can move before the long-press timer fires without
// cancelling it - past this while still waiting reads as a scroll, not a
// held finger, so the timer is dropped. The row's own touch-action: none
// (below) means the browser never starts a native scroll on its own here -
// without it, a native scroll beginning mid-hold fires pointercancel and
// silently kills the long-press timer before it ever gets a chance to fire,
// which is exactly what made long-press-and-drag flaky on a phone. Once
// dropped, onMove below drives window.scrollBy itself (batched to once per
// animation frame - see queueScrollBy) for the rest of this touch so an
// ordinary swipe still scrolls the page; startMomentum below then picks up
// where the native fling would have on release.
const MOVE_CANCEL_PX = 10;

// Because touch-action: none (below) keeps the browser from ever seeing this
// as a scrollable element, an ordinary swipe that starts on a gap row never
// gets native momentum - onMove above already covers the 1:1 scroll while
// the finger is down, but release used to just stop dead. These constants
// reimplement that missing momentum by hand: an exponential-decay fling
// driven by the touch's own recent velocity, restarted every animation
// frame until it decays below MOMENTUM_MIN_VELOCITY or gets interrupted.
// MOMENTUM_FRICTION is expressed per-ms (not per-frame) so the decay rate
// doesn't depend on the display's refresh rate; ~0.9968 matches the common
// "0.95 per 16ms frame" convention. MOMENTUM_STALE_MS guards the case where
// the finger stopped moving and just sat there before lifting - without it,
// a fast swipe that paused before release would still be read as a flick.
const MOMENTUM_FRICTION_PER_MS = 0.9968;
const MOMENTUM_MIN_VELOCITY = 0.02; // px/ms; below this the fling is imperceptible, so stop
const MOMENTUM_MAX_VELOCITY = 5; // px/ms; clamps a noisy single-sample velocity spike
const MOMENTUM_STALE_MS = 60;

// Once picking is active, every this-many px of drag nudges the time by one
// 30-minute step - a fixed screen-space rate, deliberately independent of
// how many real minutes this particular gap's own (sqrt-compressed, see
// durationPx) height happens to represent. Mapping the pointer's absolute
// position straight to a time - what the initial anchor below still does,
// deliberately coarsely - makes fine picking on a mostly-idle stretch nearly
// impossible: a day with nothing on it can render just a few dozen px tall,
// so every pixel would cover tens of real minutes. Scrubbing by relative
// motion instead keeps one drag gesture equally fine everywhere, whether the
// gap under it is 20 minutes or three empty weeks. Doubled from the old
// 15-minute step's 12px so the px-per-real-minute drag feel is unchanged.
const PX_PER_HALF_HOUR = 24;

type Preview = { kind: "point"; ms: number } | { kind: "range"; startMs: number; endMs: number } | null;

interface AgendaGapRowProps {
  entry: AgendaGapEntry;
  // Fires once, on release, with the picked start time - and, only for a
  // desktop drag that actually spans real time, the picked duration in
  // minutes (a plain click/tap, or a touch long-press, only ever picks a
  // single point; the caller falls back to its own default duration then).
  onPick: (startMs: number, durationMinutes?: number) => void;
}

// One row of the Agenda's blank idle-time span, reworked from a purely
// static spacer into the surface "create an event here" is picked from:
// hovering (mouse) or a long-press-then-drag (touch) previews a line/range
// snapped to the nearest 30 minutes, and releasing hands the picked
// time(s) back to the caller to open the New Event page with. Owns its own
// preview state (rather than lifting it to AgendaPage) so a mousemove over
// one row's idle time never re-renders the whole timeline.
export function AgendaGapRow({ entry, onPick }: AgendaGapRowProps) {
  const heightPx = gapHeightPx(entry.minutes, entry.dayBreaks.length + 1);
  const rootRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<Preview>(null);
  const [dragging, setDragging] = useState(false);

  const anchorMsRef = useRef<number | null>(null);
  // The clientY the anchor above was actually computed from - not
  // necessarily the original pointerdown position, since a touch's anchor is
  // set later, once the long press fires. Every subsequent fine-drag delta
  // is measured from here, not from wherever the gesture first began.
  const anchorClientYRef = useRef(0);
  const pointerTypeRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const startClientRef = useRef<{ x: number; y: number } | null>(null);
  const lastClientYRef = useRef<number>(0);
  // Every AgendaGapRow keeps its own window-level listeners live at once, so
  // without this a touch that started on some *other* row's blank space
  // would still hit this row's own pointermove handler below - this is what
  // scopes the manual-scroll takeover (and the long-press machinery
  // generally) to only the one pointer that actually went down on this row.
  const activePointerIdRef = useRef<number | null>(null);
  // Manual-scroll replication (see MOVE_CANCEL_PX) is batched into one
  // window.scrollBy per animation frame rather than called straight from
  // every pointermove - iOS Safari's own scroll/rubber-band bookkeeping
  // reads as genuinely corrupted (scrolling elsewhere on the page turns
  // erratic and stays that way) when a touch-action: none element drives
  // scrollBy synchronously many times within a single frame.
  const scrollDeltaRef = useRef(0);
  const scrollRafRef = useRef<number | null>(null);
  // Velocity (px/ms, same sign convention as queueScrollBy's deltaY) of the
  // touch's own most recent pointermove sample, plus when that sample was
  // taken - both feed startMomentum on release. wasManualScrollRef marks
  // that this gesture actually got read as a scroll (long-press timer
  // cancelled by movement) rather than a tap or a still-pending hold, since
  // only a real scroll should fling on release.
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

  // Starts the manual fling described above. releaseTimeStamp is the
  // pointerup event's own timeStamp, used against lastMoveTimeRef to detect
  // a finger that had already stopped moving before it lifted.
  function startMomentum(releaseTimeStamp: number) {
    const stale = releaseTimeStamp - lastMoveTimeRef.current > MOMENTUM_STALE_MS;
    let velocity = stale ? 0 : velocityRef.current;
    velocity = Math.max(-MOMENTUM_MAX_VELOCITY, Math.min(MOMENTUM_MAX_VELOCITY, velocity));
    if (Math.abs(velocity) < MOMENTUM_MIN_VELOCITY) return;

    // A real touch landing anywhere (not just this row) or a wheel spin both
    // read as "the user grabbed the page again" - same as native momentum
    // scrolling, either kills the fling immediately rather than fighting it.
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

  // Converts a viewport Y coordinate into an absolute, 30-minute-snapped
  // instant within this gap's own span - clamped to the gap's own bounds so
  // a drag that strays above/below the row (or past its edges on a short
  // gap) never picks a time outside what's actually idle here.
  function msAtClientY(clientY: number): number {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.height <= 0) return entry.startMs;
    const offsetPx = Math.min(rect.height, Math.max(0, clientY - rect.top));
    const fraction = offsetPx / rect.height;
    return snapToHalfHour(entry.startMs + fraction * entry.minutes * 60_000);
  }

  function fineMsFromDelta(anchorMs: number, deltaPx: number): number {
    return fineTimeFromDelta(anchorMs, deltaPx, PX_PER_HALF_HOUR, entry.startMs, entry.minutes);
  }

  function topPercent(ms: number): number {
    return Math.min(100, Math.max(0, ((ms - entry.startMs) / (entry.minutes * 60_000)) * 100));
  }

  function handlePointerEnter(e: React.PointerEvent) {
    if (e.pointerType !== "mouse" || dragging) return;
    setPreview({ kind: "point", ms: msAtClientY(e.clientY) });
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (e.pointerType !== "mouse" || dragging) return;
    setPreview({ kind: "point", ms: msAtClientY(e.clientY) });
  }

  function handlePointerLeave() {
    if (dragging) return;
    setPreview(null);
  }

  function handlePointerDown(e: React.PointerEvent) {
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
      const ms = msAtClientY(e.clientY);
      anchorMsRef.current = ms;
      anchorClientYRef.current = e.clientY;
      setPreview({ kind: "point", ms });
      setDragging(true);
    } else {
      // Touch/pen: only commit to picking a time after a genuine hold -
      // the "pending" effect below cancels this the moment the finger
      // moves enough to read as a scroll instead.
      timerRef.current = window.setTimeout(() => {
        const ms = msAtClientY(lastClientYRef.current);
        anchorMsRef.current = ms;
        anchorClientYRef.current = lastClientYRef.current;
        setPreview({ kind: "point", ms });
        setDragging(true);
        navigator.vibrate?.(10);
      }, LONG_PRESS_MS);
    }
  }

  useEffect(() => {
    if (!dragging) {
      // Waiting out the long-press window (or nothing pressed at all) - only
      // watching for enough movement to cancel it and fall back to ordinary
      // scrolling, or an early release that abandons it entirely.
      function onMove(e: PointerEvent) {
        if (e.pointerId !== activePointerIdRef.current) return;
        const prevClientY = lastClientYRef.current;
        lastClientYRef.current = e.clientY;
        // touch-action: none below means the default action is already
        // suppressed - no need for our own preventDefault on top of it,
        // which is one less thing fighting iOS's own touch bookkeeping.
        // Replicate the scroll by hand (1:1 while the finger is down; see
        // startMomentum for what carries it on after release) so a swipe
        // that starts on a gap row still moves the page.
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

    // Actively picking: a mouse drag previews (and eventually picks) a
    // start+duration range; a touch drag only ever fine-tunes the single
    // start point, per the mobile spec this followed - the user explicitly
    // called out that only a desktop drag also determines an end time. Both
    // read the pointer's position only as a delta from the anchor (see
    // fineMsFromDelta) rather than re-deriving an absolute time from it.
    function onMove(e: PointerEvent) {
      e.preventDefault();
      const anchor = anchorMsRef.current;
      if (anchor === null) return;
      const ms = fineMsFromDelta(anchor, e.clientY - anchorClientYRef.current);
      if (pointerTypeRef.current === "mouse") {
        setPreview(ms === anchor ? { kind: "point", ms } : { kind: "range", startMs: Math.min(anchor, ms), endMs: Math.max(anchor, ms) });
      } else {
        setPreview({ kind: "point", ms });
      }
    }
    function finish(e: PointerEvent) {
      const anchor = anchorMsRef.current;
      const finalMs = anchor === null ? entry.startMs : fineMsFromDelta(anchor, e.clientY - anchorClientYRef.current);
      setDragging(false);
      setPreview(null);
      anchorMsRef.current = null;
      activePointerIdRef.current = null;
      if (anchor === null) return;
      if (pointerTypeRef.current === "mouse") {
        const startMs = Math.min(anchor, finalMs);
        const durationMinutes = Math.round(Math.abs(finalMs - anchor) / 60_000);
        onPick(startMs, durationMinutes > 0 ? durationMinutes : undefined);
      } else {
        onPick(finalMs);
      }
    }
    function onCancel() {
      setDragging(false);
      setPreview(null);
      anchorMsRef.current = null;
      activePointerIdRef.current = null;
    }
    // Right-click (its contextmenu, not the button-2 pointerdown itself,
    // which handlePointerDown already ignores) and Escape both abandon an
    // in-progress pick without creating anything - the contextmenu is
    // prevented so a right-click reads purely as "cancel", not also popping
    // the browser's own menu on top of it.
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

  return (
    <div
      ref={rootRef}
      className="relative flex select-none gap-3 px-1"
      style={{ height: heightPx, touchAction: "none" }}
      onPointerEnter={handlePointerEnter}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onPointerDown={handlePointerDown}
    >
      <div className="w-16 shrink-0" aria-hidden="true" />
      <div className="relative flex-1">
        <span className="absolute inset-y-0 left-0 border-l-2 border-dust/30" aria-hidden="true" />
        {!entry.past && entry.minutes >= GAP_LABEL_THRESHOLD_MINUTES && !preview && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-dust/50">
            {formatGapDuration(entry.minutes)}
          </span>
        )}
        {preview?.kind === "point" && (
          <span
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-accent/60"
            style={{ top: `${topPercent(preview.ms)}%` }}
            aria-hidden="true"
          />
        )}
        {preview?.kind === "range" && (
          <span
            className="pointer-events-none absolute inset-x-0 border-l-2 border-dashed border-accent/50 bg-accent/[0.08]"
            style={{ top: `${topPercent(preview.startMs)}%`, height: `${topPercent(preview.endMs) - topPercent(preview.startMs)}%` }}
            aria-hidden="true"
          />
        )}
      </div>
      {/* Every calendar day this gap spans gets its own header, positioned
          at its true (midnight) point inside this one continuous,
          single-duration span - not as a separate flow row, and never
          splitting the duration above into one number per day crossed. */}
      {entry.dayBreaks.map((brk) => (
        <div
          key={brk.key}
          className="absolute left-1 w-16 -translate-y-1/2 text-right font-mono text-[10px] leading-tight uppercase tracking-wide text-dust"
          style={{ top: `${Math.min(100, Math.max(0, (brk.offsetMinutes / entry.minutes) * 100))}%` }}
        >
          {brk.label}
        </div>
      ))}
      {preview?.kind === "point" && (
        <div
          className="pointer-events-none absolute left-1 w-16 -translate-y-1/2 text-right font-mono text-[10px] font-semibold text-accent"
          style={{ top: `${topPercent(preview.ms)}%` }}
        >
          {formatClockTime(preview.ms)}
        </div>
      )}
      {preview?.kind === "range" && (
        <>
          <div
            className="pointer-events-none absolute left-1 w-16 -translate-y-1/2 text-right font-mono text-[10px] font-semibold text-accent"
            style={{ top: `${topPercent(preview.startMs)}%` }}
          >
            {formatClockTime(preview.startMs)}
          </div>
          <div
            className="pointer-events-none absolute left-1 w-16 -translate-y-1/2 text-right font-mono text-[10px] text-accent/70"
            style={{ top: `${topPercent(preview.endMs)}%` }}
          >
            {formatClockTime(preview.endMs)}
          </div>
        </>
      )}
    </div>
  );
}
