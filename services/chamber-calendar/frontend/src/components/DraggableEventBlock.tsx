import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { useEventDragReschedule } from "@/lib/useEventDragReschedule";
import { formatClockTime } from "@/lib/datetime";
import type { CalendarEvent } from "../../../src/types";

interface DraggableEventBlockProps {
  event: CalendarEvent;
  href: string;
  onPrefetch: () => void;
  className: string;
  children: ReactNode;
}

// Wraps a single (non-overlapping, timed) Agenda event block with the
// shared drag-to-reschedule gesture (see useEventDragReschedule). All-day
// chips don't use this; a genuinely-overlapping (multi-column) block instead
// uses OverlapEventBlock, which wraps the identical gesture/mutation hook
// around a cluster's own absolutely-positioned paint+hit markup.
export function DraggableEventBlock({ event, href, onPrefetch, className, children }: DraggableEventBlockProps) {
  const { dragOffsetPx, pendingMs, onPointerDown, longPressStyle, onClickCapture } = useEventDragReschedule(event);

  return (
    <Link
      to={href}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      onPointerDown={onPointerDown}
      onClickCapture={onClickCapture}
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      className={className}
      style={{ ...longPressStyle, transform: dragOffsetPx ? `translateY(${dragOffsetPx}px)` : undefined }}
    >
      {children}
      {pendingMs !== 0 && (
        <span
          className="pointer-events-none absolute -top-5 left-16 z-20 whitespace-nowrap border border-accent bg-parchment px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent"
          aria-hidden="true"
        >
          {formatClockTime(new Date(event.start).getTime() + pendingMs)}
        </span>
      )}
    </Link>
  );
}
