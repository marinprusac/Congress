import { Link } from "react-router-dom";
import { useEventDragReschedule } from "@/lib/useEventDragReschedule";
import { useEventResizeDuration } from "@/lib/useEventResizeDuration";
import { useEventContextMenuGesture } from "@/lib/useEventContextMenuGesture";
import { formatClockTime, formatEventStartTime, formatEventEndTime } from "@/lib/datetime";
import { EventMoveHandle, EventResizeHandle } from "@/components/EventDragHandles";
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
// DraggableEventBlock) - same three gestures (useEventDragReschedule,
// useEventResizeDuration, useEventContextMenuGesture; see DraggableEventBlock
// for the full rundown), just applied to this layout's own two-layer markup
// instead of a single flow <Link>:
//
// - The "paint" div is the always-full-width, alpha-blended visual bar
//   (unchanged from before this block was draggable) - two overlapping
//   bars' own translucent fills still stack into a visibly darker band
//   wherever they actually overlap in time, real browser compositing.
// - The "hit" <Link> is the actual tap/press target, narrowed to this
//   block's own column only when it substantially overlaps another block in
//   the cluster (so both stay independently reachable), full width
//   otherwise. The move/resize nudges live inside it, so their own hit
//   testing lines up with the visible bar.
//
// All three receive the identical live drag/resize state from the one hook
// instances below, so the block the user is actually holding visibly
// moves/resizes as a whole - not just its (otherwise invisible) hit target -
// while the other blocks in the same cluster stay put until this one's own
// change actually commits and the whole timeline reflows around it.
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
  const { dragOffsetPx, pendingMs, onPointerDown: onMovePointerDown, longPressStyle: moveStyle, onClickCapture: onMoveClickCapture } =
    useEventDragReschedule(event);
  const { resizeOffsetPx, onPointerDown: onResizePointerDown, longPressStyle: resizeStyle, onClickCapture: onResizeClickCapture } =
    useEventResizeDuration(event);
  const { onPointerDown: onMenuPointerDown, longPressStyle: menuStyle, onContextMenu } = useEventContextMenuGesture(event);

  const transform = dragOffsetPx ? `translateY(${dragOffsetPx}px)` : undefined;
  const liveHeight = Math.max(0, height + resizeOffsetPx);

  function onBodyPointerDown(e: React.PointerEvent) {
    if (e.pointerType === "mouse") onMovePointerDown(e);
    else onMenuPointerDown(e);
  }

  function onClickCapture(e: React.MouseEvent) {
    onMoveClickCapture(e);
    onResizeClickCapture(e);
  }

  return (
    <>
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-x-0 overflow-hidden border-l-2 py-1 ${
          unconfirmed ? "border-dashed border-accent/50 bg-accent/[0.03]" : "border-accent bg-accent/[0.08]"
        }`}
        style={{ top, height: liveHeight, zIndex: stackIndex + 1, transform }}
      >
        <div
          className={`truncate font-display text-xs leading-snug ${unconfirmed ? "text-ink/70" : "text-ink"}`}
          style={{ paddingLeft: textIndent, paddingRight: 8 }}
        >
          {event.title}
        </div>
        {liveHeight > 30 && (
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
        onPointerDown={onBodyPointerDown}
        onContextMenu={onContextMenu}
        onClickCapture={onClickCapture}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        aria-label={`${event.title}, ${formatEventStartTime(event)}–${formatEventEndTime(event)}`}
        className="absolute rounded-sm hover:bg-accent/20 focus-visible:bg-accent/20"
        style={{
          ...moveStyle,
          ...menuStyle,
          top,
          height: liveHeight,
          left: `${leftPercent}%`,
          width: `${widthPercent}%`,
          zIndex: 100 + stackIndex,
          transform,
        }}
      >
        {event.editable && <EventMoveHandle onPointerDown={onMovePointerDown} style={moveStyle} />}
        {event.editable && <EventResizeHandle onPointerDown={onResizePointerDown} style={resizeStyle} />}
      </Link>
    </>
  );
}
