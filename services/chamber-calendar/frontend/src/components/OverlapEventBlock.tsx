import { Link } from "react-router-dom";
import { useEventDragReschedule } from "@/lib/useEventDragReschedule";
import { formatClockTime, formatEventStartTime, formatEventEndTime } from "@/lib/datetime";
import type { AgendaEventBlock } from "@/lib/datetime";

interface OverlapEventBlockProps {
  block: AgendaEventBlock;
  stackIndex: number;
  unconfirmed: boolean;
  top: number;
  height: number;
  leftPercent: number;
  widthPercent: number;
  textIndent: string;
  nowPercent: number | null;
  href: string;
  onPrefetch: () => void;
}

// One block inside a genuinely-overlapping Agenda cluster (AgendaPage's
// other cluster branch, where a lone non-overlapping block instead uses
// DraggableEventBlock) - same drag-to-reschedule gesture (see
// useEventDragReschedule), just applied to this layout's own two-layer
// markup instead of a single flow <Link>:
//
// - The "paint" div is the always-full-width, alpha-blended visual bar
//   (unchanged from before this block was draggable) - two overlapping
//   bars' own translucent fills still stack into a visibly darker band
//   wherever they actually overlap in time, real browser compositing.
// - The "hit" <Link> is the actual tap/press target, narrowed to this
//   block's own column only when it substantially overlaps another block in
//   the cluster (so both stay independently reachable), full width
//   otherwise.
//
// Both receive the identical live drag transform from the one hook instance
// below, so the block the user is actually holding visibly moves as a whole
// - not just its (otherwise invisible) hit target - while the other blocks
// in the same cluster stay put until this one's own move actually commits
// and the whole timeline reflows around it.
export function OverlapEventBlock({
  block,
  stackIndex,
  unconfirmed,
  top,
  height,
  leftPercent,
  widthPercent,
  textIndent,
  nowPercent,
  href,
  onPrefetch,
}: OverlapEventBlockProps) {
  const event = block.event;
  const { dragOffsetPx, pendingMs, onPointerDown, longPressStyle, onClickCapture } = useEventDragReschedule(event);
  const transform = dragOffsetPx ? `translateY(${dragOffsetPx}px)` : undefined;

  return (
    <>
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-x-0 overflow-hidden border-l-2 py-1 ${
          unconfirmed ? "border-dashed border-accent/50 bg-accent/[0.03]" : "border-accent bg-accent/[0.08]"
        }`}
        style={{ top, height, zIndex: stackIndex + 1, transform }}
      >
        <div
          className={`truncate font-display text-xs leading-snug ${unconfirmed ? "text-ink/70" : "text-ink"}`}
          style={{ paddingLeft: textIndent, paddingRight: 8 }}
        >
          {event.title}
        </div>
        {height > 30 && (
          <div className="truncate font-mono text-[10px] text-dust" style={{ paddingLeft: textIndent, paddingRight: 8 }}>
            {formatEventStartTime(event)}
          </div>
        )}
        {nowPercent !== null && (
          <div className="pointer-events-none absolute inset-x-0 h-px bg-alert" style={{ top: `${nowPercent}%` }} aria-hidden="true" />
        )}
        {pendingMs !== 0 && (
          <span
            className="pointer-events-none absolute -top-5 left-0 z-20 whitespace-nowrap border border-accent bg-parchment px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent"
            aria-hidden="true"
          >
            {formatClockTime(new Date(event.start).getTime() + pendingMs)}
          </span>
        )}
      </div>
      <Link
        to={href}
        onMouseEnter={onPrefetch}
        onFocus={onPrefetch}
        onPointerDown={onPointerDown}
        onClickCapture={onClickCapture}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        aria-label={`${event.title}, ${formatEventStartTime(event)}–${formatEventEndTime(event)}`}
        className="absolute rounded-sm hover:bg-accent/20 focus-visible:bg-accent/20"
        style={{ ...longPressStyle, top, height, left: `${leftPercent}%`, width: `${widthPercent}%`, zIndex: 100 + stackIndex, transform }}
      />
    </>
  );
}
