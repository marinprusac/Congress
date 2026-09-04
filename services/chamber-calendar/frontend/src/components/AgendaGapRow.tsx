import { useEffect, useRef, useState } from "react";
import { durationPx, formatClockTime, formatGapDuration, snapToQuarterHour } from "@/lib/datetime";
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
// held finger, so the timer is dropped and the page scrolls normally.
const MOVE_CANCEL_PX = 10;

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
// snapped to the nearest 15 minutes, and releasing hands the picked
// time(s) back to the caller to open the New Event page with. Owns its own
// preview state (rather than lifting it to AgendaPage) so a mousemove over
// one row's idle time never re-renders the whole timeline.
export function AgendaGapRow({ entry, onPick }: AgendaGapRowProps) {
  const heightPx = Math.max(4, durationPx(entry.minutes));
  const rootRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<Preview>(null);
  const [dragging, setDragging] = useState(false);

  const anchorMsRef = useRef<number | null>(null);
  const pointerTypeRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const startClientRef = useRef<{ x: number; y: number } | null>(null);
  const lastClientYRef = useRef<number>(0);

  function clearTimer() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  // Converts a viewport Y coordinate into an absolute, 15-minute-snapped
  // instant within this gap's own span - clamped to the gap's own bounds so
  // a drag that strays above/below the row (or past its edges on a short
  // gap) never picks a time outside what's actually idle here.
  function msAtClientY(clientY: number): number {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.height <= 0) return entry.startMs;
    const offsetPx = Math.min(rect.height, Math.max(0, clientY - rect.top));
    const fraction = offsetPx / rect.height;
    return snapToQuarterHour(entry.startMs + fraction * entry.minutes * 60_000);
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
    pointerTypeRef.current = e.pointerType;
    startClientRef.current = { x: e.clientX, y: e.clientY };
    lastClientYRef.current = e.clientY;
    clearTimer();
    if (e.pointerType === "mouse") {
      const ms = msAtClientY(e.clientY);
      anchorMsRef.current = ms;
      setPreview({ kind: "point", ms });
      setDragging(true);
    } else {
      // Touch/pen: only commit to picking a time after a genuine hold -
      // the "pending" effect below cancels this the moment the finger
      // moves enough to read as a scroll instead.
      timerRef.current = window.setTimeout(() => {
        const ms = msAtClientY(lastClientYRef.current);
        anchorMsRef.current = ms;
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
        lastClientYRef.current = e.clientY;
        if (!startClientRef.current || timerRef.current === null) return;
        const dx = e.clientX - startClientRef.current.x;
        const dy = e.clientY - startClientRef.current.y;
        if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) clearTimer();
      }
      function onUp() {
        clearTimer();
        startClientRef.current = null;
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

    // Actively picking: a mouse drag previews (and eventually picks) a
    // start+duration range; a touch drag only ever fine-tunes the single
    // start point, per the mobile spec this followed - the user explicitly
    // called out that only a desktop drag also determines an end time.
    function onMove(e: PointerEvent) {
      e.preventDefault();
      const ms = msAtClientY(e.clientY);
      const anchor = anchorMsRef.current;
      if (pointerTypeRef.current === "mouse" && anchor !== null) {
        setPreview(ms === anchor ? { kind: "point", ms } : { kind: "range", startMs: Math.min(anchor, ms), endMs: Math.max(anchor, ms) });
      } else {
        setPreview({ kind: "point", ms });
      }
    }
    function finish(e: PointerEvent) {
      const anchor = anchorMsRef.current;
      const finalMs = msAtClientY(e.clientY);
      setDragging(false);
      setPreview(null);
      anchorMsRef.current = null;
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
    }
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", onCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  useEffect(() => clearTimer, []);

  return (
    <div
      ref={rootRef}
      className="relative flex select-none gap-3 px-1"
      style={{ height: heightPx }}
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
