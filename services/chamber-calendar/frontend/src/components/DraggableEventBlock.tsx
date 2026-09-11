import { Link } from "react-router-dom";
import { useEventDragReschedule } from "@/lib/useEventDragReschedule";
import { useEventResizeDuration } from "@/lib/useEventResizeDuration";
import { useEventContextMenuGesture } from "@/lib/useEventContextMenuGesture";
import { formatClockTime } from "@/lib/datetime";
import { EventMoveHandle, EventResizeHandle } from "@/components/EventDragHandles";
import type { CalendarEvent } from "../../../src/types";

interface DraggableEventBlockProps {
  event: CalendarEvent;
  href: string;
  onPrefetch: () => void;
  className: string;
  // A render prop (not a plain node) so this component can hand back the
  // live resizeOffsetPx the bottom handle produces - AgendaPage's own inner
  // div owns the block's actual minHeight (clusterHeightPx), and needs that
  // offset added to it live while resizing, for the exact same "already
  // correct the instant it's released" reason useEventDragReschedule's own
  // dragOffsetPx no longer needs a guess-and-hold (see that hook's onDragEnd).
  children: (resizeOffsetPx: number) => React.ReactNode;
}

// Wraps a single (non-overlapping, timed) Agenda event block with its three
// gestures: useEventDragReschedule (move, triggered by the body on mouse or
// the right-edge nudge on touch), useEventResizeDuration (duration, the
// bottom-edge nudge only), and useEventContextMenuGesture (long-press/
// right-click, reserved for a menu built later). All-day chips don't use
// this; a genuinely-overlapping (multi-column) block instead uses
// OverlapEventBlock, which wraps the identical three hooks around a
// cluster's own absolutely-positioned paint+hit markup.
export function DraggableEventBlock({ event, href, onPrefetch, className, children }: DraggableEventBlockProps) {
  const { dragOffsetPx, pendingMs, onPointerDown: onMovePointerDown, longPressStyle: moveStyle, onClickCapture: onMoveClickCapture } =
    useEventDragReschedule(event);
  const { resizeOffsetPx, onPointerDown: onResizePointerDown, longPressStyle: resizeStyle, onClickCapture: onResizeClickCapture } =
    useEventResizeDuration(event);
  const { onPointerDown: onMenuPointerDown, longPressStyle: menuStyle, onContextMenu } = useEventContextMenuGesture(event);

  // Mouse presses on the body still drag to move, exactly as before; touch/
  // pen presses on the body no longer drag anything (that moved onto the
  // right-edge nudge below) - they instead feed the long-press-reserved-for-
  // a-menu gesture.
  function onBodyPointerDown(e: React.PointerEvent) {
    if (e.pointerType === "mouse") onMovePointerDown(e);
    else onMenuPointerDown(e);
  }

  function onClickCapture(e: React.MouseEvent) {
    onMoveClickCapture(e);
    onResizeClickCapture(e);
  }

  return (
    <Link
      to={href}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      onPointerDown={onBodyPointerDown}
      onContextMenu={onContextMenu}
      onClickCapture={onClickCapture}
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      className={className}
      style={{ ...moveStyle, ...menuStyle, transform: dragOffsetPx ? `translateY(${dragOffsetPx}px)` : undefined }}
    >
      {children(resizeOffsetPx)}
      {pendingMs !== 0 && (
        <span
          className="pointer-events-none absolute -top-5 left-16 z-20 whitespace-nowrap border border-accent bg-parchment px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent"
          aria-hidden="true"
        >
          {formatClockTime(new Date(event.start).getTime() + pendingMs)}
        </span>
      )}
      {event.editable && <EventMoveHandle onPointerDown={onMovePointerDown} style={moveStyle} />}
      {event.editable && <EventResizeHandle onPointerDown={onResizePointerDown} style={resizeStyle} />}
    </Link>
  );
}
