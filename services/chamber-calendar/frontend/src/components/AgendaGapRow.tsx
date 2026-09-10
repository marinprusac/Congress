import { useRef, useState } from "react";
import { useLongPressDrag } from "@congress/congress-ui";
import { fineTimeFromDelta, formatClockTime, formatGapDuration, gapHeightPx, snapToHalfHour } from "@/lib/datetime";
import type { AgendaGapEntry } from "@/lib/datetime";

// Below this, a gap's blank space stays unlabeled - long enough to be worth
// naming, but a 5-minute breather between back-to-back meetings doesn't
// need its own caption.
const GAP_LABEL_THRESHOLD_MINUTES = 20;

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
// one row's idle time never re-renders the whole timeline. The long-press/
// drag/momentum mechanics themselves live in the shared `useLongPressDrag`
// (packages/congress-ui) - this component only turns a raw pixel delta from
// that hook into a snapped time via fineTimeFromDelta.
export function AgendaGapRow({ entry, onPick }: AgendaGapRowProps) {
  const heightPx = gapHeightPx(entry.minutes, entry.dayBreaks.length + 1);
  const rootRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<Preview>(null);

  const anchorMsRef = useRef<number | null>(null);
  // useLongPressDrag hands back a pointerType-agnostic pixel delta - this
  // chamber's own mouse-vs-touch behavior (a desktop drag can also pick a
  // duration; touch only ever fine-tunes a single point) still needs to
  // know which one is live, so it's tracked here rather than in the hook.
  const pointerTypeRef = useRef<string | null>(null);

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

  const { dragging, onPointerDown: longPressPointerDown, style: longPressStyle } = useLongPressDrag({
    onActivate: (clientY) => {
      const ms = msAtClientY(clientY);
      anchorMsRef.current = ms;
      setPreview({ kind: "point", ms });
    },
    onDragMove: (deltaPx) => {
      const anchor = anchorMsRef.current;
      if (anchor === null) return;
      const ms = fineMsFromDelta(anchor, deltaPx);
      if (pointerTypeRef.current === "mouse") {
        setPreview(ms === anchor ? { kind: "point", ms } : { kind: "range", startMs: Math.min(anchor, ms), endMs: Math.max(anchor, ms) });
      } else {
        setPreview({ kind: "point", ms });
      }
    },
    onDragEnd: (deltaPx) => {
      const anchor = anchorMsRef.current;
      const finalMs = anchor === null ? entry.startMs : fineMsFromDelta(anchor, deltaPx);
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
    },
    onDragCancel: () => {
      setPreview(null);
      anchorMsRef.current = null;
    },
  });

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
    pointerTypeRef.current = e.pointerType;
    longPressPointerDown(e);
  }

  return (
    <div
      ref={rootRef}
      className="relative flex select-none gap-3 px-1"
      style={{ height: heightPx, ...longPressStyle }}
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
