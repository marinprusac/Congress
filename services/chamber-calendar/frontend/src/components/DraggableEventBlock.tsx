import { useLayoutEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useEventContextMenuGesture } from "@/lib/useEventContextMenuGesture";
import { formatClockTime } from "@/lib/datetime";
import type { AgendaDragController } from "@/lib/useAgendaDragController";
import { EventMoveHandle, EventResizeHandle } from "@/components/EventDragHandles";
import type { CalendarEvent } from "../../../src/types";

interface DraggableEventBlockProps {
  event: CalendarEvent;
  href: string;
  onPrefetch: () => void;
  className: string;
  dragController: AgendaDragController;
  // A render prop (not a plain node) so this component can hand back a ref
  // callback for the actual visible content box - AgendaPage's own inner div
  // owns the block's minHeight, and is what needs to register as the resize
  // gesture's target box (see dragController.attachResizeElement), not this
  // component's own outer <Link> (which also wraps the time-gutter column
  // beside it, and would size the wrong thing).
  children: (ctx: { resizeRef: (el: HTMLElement | null) => void; handles: React.ReactNode }) => React.ReactNode;
}

// Wraps a single (non-overlapping, timed) Agenda event block with its three
// gestures: move (triggered by the body on mouse or the right-edge nudge on
// touch) and resize (the bottom-edge nudge only), both driven by the shared,
// page-level dragController (see useAgendaDragController for why it's
// page-level rather than a hook owned by this component), plus
// useEventContextMenuGesture (long-press/right-click, reserved for a menu
// built later, kept local since it never needs to survive this component
// unmounting mid-gesture). All-day chips don't use this; a genuinely-
// overlapping (multi-column) block instead uses OverlapEventBlock.
export function DraggableEventBlock({ event, href, onPrefetch, className, dragController, children }: DraggableEventBlockProps) {
  const linkRef = useRef<HTMLAnchorElement>(null);
  const resizeElRef = useRef<HTMLElement | null>(null);
  const binding = dragController.forEvent(event);
  const { onMovePointerDown, onResizePointerDown, moveStyle, resizeStyle, onClickCapture, pendingStartMs, pendingEndMs } = binding;
  const { onPointerDown: onMenuPointerDown, longPressStyle: menuStyle, onContextMenu } = useEventContextMenuGesture(event);

  // Registers this block's own root element as the move gesture's live
  // target exactly while it's the actively-dragged one - re-runs (and so
  // re-measures, see attachMoveElement) whenever the reflow around it
  // actually changes, and cleanly (re)attaches across a cluster-membership
  // remount too, since isActiveMove going true again on a freshly-mounted
  // instance re-triggers this effect from scratch.
  useLayoutEffect(() => {
    if (!binding.isActiveMove || !linkRef.current) return;
    return dragController.attachMoveElement(linkRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binding.isActiveMove, dragController.livePreview]);

  // Same registration idea as the move effect above, but targeting whatever
  // element resizeRef below was handed (AgendaPage's own content div, not
  // this component's outer Link) - re-fires on the same [isActiveResize,
  // livePreview] schedule so a remount mid-resize re-registers cleanly too.
  useLayoutEffect(() => {
    if (!binding.isActiveResize || !resizeElRef.current) return;
    return dragController.attachResizeElement(resizeElRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binding.isActiveResize, dragController.livePreview]);

  function onBodyPointerDown(e: React.PointerEvent) {
    if (e.pointerType === "mouse") onMovePointerDown(e);
    else onMenuPointerDown(e);
  }

  // Measures the resize target's true, still-unsuppressed height and hands
  // it to the controller *before* the gesture activates - see
  // primeResizeBaseHeight's own doc comment for why this has to happen here
  // (synchronously, ahead of any state update) rather than once the drag is
  // already under way.
  function onResizePointerDownPrimed(e: React.PointerEvent) {
    if (resizeElRef.current) {
      dragController.primeResizeBaseHeight(resizeElRef.current.getBoundingClientRect().height);
    }
    onResizePointerDown(e);
  }

  const handles = (
    <>
      {event.editable && <EventMoveHandle onPointerDown={onMovePointerDown} style={moveStyle} />}
      {event.editable && <EventResizeHandle onPointerDown={onResizePointerDownPrimed} style={resizeStyle} />}
    </>
  );

  function resizeRef(el: HTMLElement | null) {
    resizeElRef.current = el;
  }

  return (
    <Link
      ref={linkRef}
      to={href}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      onPointerDown={onBodyPointerDown}
      onContextMenu={onContextMenu}
      onClickCapture={onClickCapture}
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      className={className}
      style={{
        ...moveStyle,
        ...menuStyle,
        // While actively dragged, this block moves via an imperative
        // transform (see useAgendaDragController) that can place it
        // anywhere on screen, independent of the document flow beneath it -
        // including squarely on top of the now-marker row's own z-10 line,
        // which would otherwise show straight through this block's
        // translucent background. Only raised while active so an
        // undragged block still sits in its ordinary (z-index: auto)
        // stacking position the rest of the time.
        zIndex: binding.isActiveMove || binding.isActiveResize ? 15 : undefined,
      }}
    >
      {children({ resizeRef, handles })}
      {pendingStartMs !== null && (
        <span
          className="pointer-events-none absolute -top-5 left-16 z-20 whitespace-nowrap border border-accent bg-parchment px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent"
          aria-hidden="true"
        >
          {formatClockTime(pendingStartMs)}
        </span>
      )}
      {pendingEndMs !== null && (
        <span
          className="pointer-events-none absolute -bottom-5 left-16 z-20 whitespace-nowrap border border-accent bg-parchment px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent"
          aria-hidden="true"
        >
          {formatClockTime(pendingEndMs)}
        </span>
      )}
    </Link>
  );
}
