import { useLayoutEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useEventContextMenuGesture } from "@/lib/useEventContextMenuGesture";
import { formatClockTime, formatEventStartTime, formatEventEndTime } from "@/lib/datetime";
import { MIN_BLOCK_HEIGHT_PX } from "@/lib/useAgendaDragController";
import type { AgendaDragController } from "@/lib/useAgendaDragController";
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
  dragController: AgendaDragController;
}

// One block inside a genuinely-overlapping Agenda cluster (AgendaPage's
// other cluster branch, where a lone non-overlapping block instead uses
// DraggableEventBlock) - same move/resize gestures (both driven by the
// shared, page-level dragController - see useAgendaDragController) plus
// useEventContextMenuGesture, applied to this layout's own two-layer markup
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
// Both the paint div and the hit Link register with the drag controller
// while this event is the active one, so both move/resize together as a
// single visible unit - not just the (otherwise invisible) hit target -
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
  dragController,
}: OverlapEventBlockProps) {
  const event = block.event;
  const binding = dragController.forEvent(event);
  const { onMovePointerDown, onResizePointerDown, moveStyle, resizeStyle, onClickCapture, pendingStartMs, pendingEndMs } = binding;
  const { onPointerDown: onMenuPointerDown, longPressStyle: menuStyle, onContextMenu } = useEventContextMenuGesture(event);

  const paintRef = useRef<HTMLDivElement>(null);
  const hitRef = useRef<HTMLAnchorElement>(null);

  useLayoutEffect(() => {
    if (!binding.isActiveMove) return;
    const els = [paintRef.current, hitRef.current].filter((el): el is HTMLDivElement | HTMLAnchorElement => el !== null);
    const cleanups = els.map((el) => dragController.attachMoveElement(el));
    return () => cleanups.forEach((cleanup) => cleanup());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binding.isActiveMove, dragController.livePreview]);

  useLayoutEffect(() => {
    if (!binding.isActiveResize) return;
    const els = [paintRef.current, hitRef.current].filter((el): el is HTMLDivElement | HTMLAnchorElement => el !== null);
    const cleanups = els.map((el) => dragController.attachResizeElement(el));
    return () => cleanups.forEach((cleanup) => cleanup());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binding.isActiveResize, dragController.livePreview]);

  // While a resize is actively (imperatively) driving this block's real
  // height, the ordinary coarse (sqrt-scaled, snapped-preview) height below
  // must not compete with it - React would otherwise stomp the imperative
  // value straight back on every re-render, since (unlike transform, which
  // this component never declares at all) `height` is an explicit style
  // property here. Suppressing it down to the shared floor lets the
  // controller's own height win outright for as long as the drag lasts.
  const liveHeight = binding.isActiveResize ? MIN_BLOCK_HEIGHT_PX : Math.max(0, height);

  function onBodyPointerDown(e: React.PointerEvent) {
    if (e.pointerType === "mouse") onMovePointerDown(e);
    else onMenuPointerDown(e);
  }

  // Same reasoning as DraggableEventBlock's own onResizePointerDownPrimed -
  // measure the true, still-unsuppressed height before the gesture
  // activates and suppresses it. paintRef and hitRef always share the same
  // height, so either works as the source measurement.
  function onResizePointerDownPrimed(e: React.PointerEvent) {
    if (paintRef.current) {
      dragController.primeResizeBaseHeight(paintRef.current.getBoundingClientRect().height);
    }
    onResizePointerDown(e);
  }

  // While actively dragged, both layers move via an imperative transform/
  // height (see useAgendaDragController) that can place them anywhere on
  // screen, independent of the document flow beneath them - including
  // squarely on top of the now-marker row's own z-10 line, which would
  // otherwise show straight through the paint layer's translucent
  // background. Raised above it (but still below .list-search-row's z-20 -
  // see the hit layer's own comment below) only while active, never lower
  // than each layer's own ordinary stacking value.
  const isDragActive = binding.isActiveMove || binding.isActiveResize;

  return (
    <>
      <div
        ref={paintRef}
        aria-hidden="true"
        className={`pointer-events-none absolute inset-x-0 overflow-hidden border-l-2 py-1 ${
          unconfirmed ? "border-dashed border-accent/50 bg-accent/[0.03]" : "border-accent bg-accent/[0.08]"
        }`}
        style={{ top, height: liveHeight, zIndex: isDragActive ? Math.max(15, stackIndex + 1) : stackIndex + 1 }}
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
        {pendingStartMs !== null && (
          <span
            className="pointer-events-none absolute -top-5 left-0 z-20 whitespace-nowrap border border-accent bg-parchment px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent"
            aria-hidden="true"
          >
            {formatClockTime(pendingStartMs)}
          </span>
        )}
      </div>
      <Link
        ref={hitRef}
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
          // Below .list-search-row's fixed z-index (20, see shared.css) on
          // purpose - a block dragged near the bottom of a scrolled viewport
          // must never render on top of the floating search bar.
          zIndex: isDragActive ? Math.max(15, 10 + stackIndex) : 10 + stackIndex,
        }}
      >
        {event.editable && <EventMoveHandle onPointerDown={onMovePointerDown} style={moveStyle} />}
        {event.editable && <EventResizeHandle onPointerDown={onResizePointerDownPrimed} style={resizeStyle} />}
        {pendingEndMs !== null && (
          <span
            className="pointer-events-none absolute -bottom-5 left-0 z-20 whitespace-nowrap border border-accent bg-parchment px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent"
            aria-hidden="true"
          >
            {formatClockTime(pendingEndMs)}
          </span>
        )}
      </Link>
    </>
  );
}
