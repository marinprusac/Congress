import { Link } from "react-router-dom";
import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLongPressDrag, showToast } from "@congress/congress-ui";
import { updateEvent } from "@/lib/api";
import {
  formatClockTime,
  getBrowserTimeZone,
  PX_PER_QUARTER_HOUR,
  snappedDeltaMs,
  snappedPxFromDeltaMs,
  toDatetimeLocalInput,
} from "@/lib/datetime";
import type { CalendarEvent } from "../../../src/types";

// Minimum raw pixel movement before a press reads as "actually dragging"
// rather than a still long-press or a plain click/tap - below this, the
// press falls through to its ordinary click/navigation behavior untouched,
// same outcome a plain tap already has (a long-press that never moves just
// opens the event, it doesn't silently swallow the tap).
const DRAG_ACTIVATE_PX = 3;

interface DraggableEventBlockProps {
  event: CalendarEvent;
  href: string;
  onPrefetch: () => void;
  className: string;
  children: ReactNode;
}

// Wraps a single (non-overlapping, timed) Agenda event block with the
// shared long-press-drag gesture (packages/congress-ui's useLongPressDrag)
// to reschedule it: dragging up/down shifts the block by a 15-minute-
// snapped amount (see snappedDeltaMs), committed on release via the same
// updateEvent PATCH EventViewPage's own autosave already uses - not
// moveEvent, which is for reassigning calendar/account and would needlessly
// change the event's exhibit id, which is unrelated to a plain time shift.
// All-day chips and genuinely-overlapping (multi-column) blocks don't use
// this - see AgendaPage's cluster case for why both are out of scope.
export function DraggableEventBlock({ event, href, onPrefetch, className, children }: DraggableEventBlockProps) {
  const queryClient = useQueryClient();
  const [dragOffsetPx, setDragOffsetPx] = useState(0);
  // Whether the current gesture ever moved past DRAG_ACTIVATE_PX - decides
  // both whether release commits a move and whether the resulting click
  // needs swallowing. Checked at click time via onClickCapture below rather
  // than relying on useLongPressDrag's own `dragging` flag, since mouse
  // activates that immediately on mousedown (see the hook's own doc) and
  // would otherwise swallow every ordinary click before it ever moves.
  const draggedRef = useRef(false);
  const durationMsRef = useRef(0);

  const moveMutation = useMutation({
    mutationFn: (deltaMs: number) => {
      const newStart = new Date(new Date(event.start).getTime() + deltaMs);
      const newEnd = new Date(newStart.getTime() + durationMsRef.current);
      return updateEvent(event.accountId, event.calendarId, event.id, {
        start: toDatetimeLocalInput(newStart.toISOString()),
        end: toDatetimeLocalInput(newEnd.toISOString()),
        allDay: false,
        timeZone: getBrowserTimeZone(),
      });
    },
    onSuccess: (updated) => {
      // Patch every cached events list synchronously (not just this one
      // event's own solo cache entry) so the Agenda's list re-sorts around
      // the new time in the same render that clears dragOffsetPx below -
      // invalidateQueries alone only marks those lists stale and refetches
      // in the background, which left the block visually snapping back to
      // its pre-drag spot for the length of that round trip before jumping
      // to its real new position once the refetch finally landed.
      queryClient.setQueriesData<{ events: CalendarEvent[] }>({ queryKey: ["events"], exact: false }, (old) => {
        if (!old || !Array.isArray(old.events)) return old;
        return {
          ...old,
          events: old.events.map((e) =>
            e.accountId === updated.accountId && e.calendarId === updated.calendarId && e.id === updated.id ? updated : e
          ),
        };
      });
      queryClient.setQueryData(["events", String(event.accountId), event.calendarId, event.id], updated);
      queryClient.invalidateQueries({ queryKey: ["events"] });
      setDragOffsetPx(0);
    },
    onError: () => {
      showToast("Failed to reschedule event.", "error");
      setDragOffsetPx(0);
    },
  });

  const { onPointerDown, style: longPressStyle } = useLongPressDrag({
    disabled: !event.editable,
    onActivate: () => {
      draggedRef.current = false;
      durationMsRef.current = new Date(event.end).getTime() - new Date(event.start).getTime();
      setDragOffsetPx(0);
    },
    onDragMove: (deltaPx) => {
      if (Math.abs(deltaPx) >= DRAG_ACTIVATE_PX) draggedRef.current = true;
      setDragOffsetPx(deltaPx);
    },
    onDragEnd: (deltaPx) => {
      if (!draggedRef.current) {
        setDragOffsetPx(0);
        return;
      }
      const deltaMs = snappedDeltaMs(deltaPx, PX_PER_QUARTER_HOUR, 15);
      if (deltaMs === 0) {
        setDragOffsetPx(0);
        return;
      }
      // Hold the block at its snapped drop position - not zero, and not the
      // raw unsnapped deltaPx - until the pending mutation settles (see
      // moveMutation's onSuccess/onError above, the only other places that
      // reset this). Resetting to zero here immediately used to make the
      // block visibly snap back to its pre-drag spot for the length of the
      // PATCH round trip before jumping to its real new position.
      setDragOffsetPx(snappedPxFromDeltaMs(deltaMs, PX_PER_QUARTER_HOUR, 15));
      moveMutation.mutate(deltaMs);
    },
    onDragCancel: () => {
      setDragOffsetPx(0);
      draggedRef.current = false;
    },
  });

  // A drag that actually moved the block must not also fire the <Link>'s own
  // navigation once the pointer lifts - capture-phase so it runs before
  // React's own onClick/router handling, same pattern useReorderableList
  // uses for NavPanel's rows.
  function onClickCapture(e: React.MouseEvent) {
    if (draggedRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
    draggedRef.current = false;
  }

  const pendingMs = dragOffsetPx !== 0 ? snappedDeltaMs(dragOffsetPx, PX_PER_QUARTER_HOUR, 15) : 0;

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
