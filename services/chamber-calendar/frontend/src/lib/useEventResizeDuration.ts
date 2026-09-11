import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLongPressDrag, showToast } from "@congress/congress-ui";
import { updateEvent } from "@/lib/api";
import {
  clampResizeDeltaPx,
  getBrowserTimeZone,
  minutesBetween,
  PX_PER_QUARTER_HOUR,
  snappedDeltaMs,
  toDatetimeLocalInput,
} from "@/lib/datetime";
import { patchEventCache } from "@/lib/useEventDragReschedule";
import type { CalendarEvent } from "../../../src/types";

// An event never resizes shorter than this - matches the 15-minute step the
// drag itself snaps to (PX_PER_QUARTER_HOUR), so the floor is always exactly
// one reachable step, never a value the drag could land on but immediately
// bounce off of.
const MIN_DURATION_MINUTES = 15;

// Same activation threshold as useEventDragReschedule's own DRAG_ACTIVATE_PX
// - a still long-press-turned-handle-press with no real movement falls
// through to the block's ordinary tap/navigation instead of committing a
// same-duration "resize".
const DRAG_ACTIVATE_PX = 3;

export interface EventResizeDurationResult {
  // Live px the block's own rendered height should grow/shrink by while
  // actively resizing - zero once released (see onDragEnd below, same
  // "optimistic cache patch lands in the same tick" reasoning
  // useEventDragReschedule's dragOffsetPx now uses for its own translateY).
  resizeOffsetPx: number;
  onPointerDown: (e: React.PointerEvent) => void;
  longPressStyle: React.CSSProperties;
  onClickCapture: (e: React.MouseEvent) => void;
}

// Drag-to-resize for a single Agenda event block's bottom-edge handle: start
// stays fixed, only end moves, snapped to the same 15-minute step
// useEventDragReschedule's own move gesture uses. Always `immediate` (see
// useLongPressDrag) - this hook is only ever wired to a small dedicated
// handle (never the block body), so there's nothing to disambiguate a
// deliberate handle-press from an ordinary scroll/tap the way the body's own
// long-press-vs-scroll gesture needs to.
export function useEventResizeDuration(event: CalendarEvent): EventResizeDurationResult {
  const queryClient = useQueryClient();
  const [resizeOffsetPx, setResizeOffsetPx] = useState(0);
  const draggedRef = useRef(false);
  const durationMinutesRef = useRef(0);
  const previousEventRef = useRef(event);

  const resizeMutation = useMutation({
    mutationFn: (newEndIso: string) =>
      updateEvent(event.accountId, event.calendarId, event.id, {
        start: toDatetimeLocalInput(event.start),
        end: toDatetimeLocalInput(newEndIso),
        allDay: false,
        timeZone: getBrowserTimeZone(),
      }),
    // Re-patches with the server's own canonical response - idempotent
    // against the optimistic patch onDragEnd already made below.
    onSuccess: (updated) => {
      patchEventCache(queryClient, updated);
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
    onError: () => {
      patchEventCache(queryClient, previousEventRef.current);
      showToast("Failed to resize event.", "error");
    },
  });

  const { onPointerDown, style: longPressStyle } = useLongPressDrag({
    immediate: true,
    disabled: !event.editable,
    onActivate: () => {
      draggedRef.current = false;
      previousEventRef.current = event;
      durationMinutesRef.current = minutesBetween(event.start, event.end);
      setResizeOffsetPx(0);
    },
    onDragMove: (deltaPx) => {
      if (Math.abs(deltaPx) >= DRAG_ACTIVATE_PX) draggedRef.current = true;
      setResizeOffsetPx(clampResizeDeltaPx(deltaPx, durationMinutesRef.current, PX_PER_QUARTER_HOUR, 15, MIN_DURATION_MINUTES));
    },
    onDragEnd: (deltaPx) => {
      if (!draggedRef.current) {
        setResizeOffsetPx(0);
        return;
      }
      const clampedPx = clampResizeDeltaPx(deltaPx, durationMinutesRef.current, PX_PER_QUARTER_HOUR, 15, MIN_DURATION_MINUTES);
      const deltaMs = snappedDeltaMs(clampedPx, PX_PER_QUARTER_HOUR, 15);
      if (deltaMs === 0) {
        setResizeOffsetPx(0);
        return;
      }
      // Same "optimistic patch lands synchronously, in the same tick the
      // live offset resets to zero" fix as useEventDragReschedule's
      // onDragEnd - the block's rendered height is already the true,
      // sqrt-scaled durationPx height by the instant the pointer lifts,
      // never a guessed offset held until the PATCH round trip resolves.
      const newEnd = new Date(new Date(event.end).getTime() + deltaMs);
      patchEventCache(queryClient, { ...event, end: newEnd.toISOString() });
      setResizeOffsetPx(0);
      resizeMutation.mutate(newEnd.toISOString());
    },
    onDragCancel: () => {
      setResizeOffsetPx(0);
      draggedRef.current = false;
    },
  });

  // Same reasoning as useEventDragReschedule's own onClickCapture - a resize
  // that actually moved the handle must not also fire the block's own
  // navigation once the pointer lifts.
  function onClickCapture(e: React.MouseEvent) {
    if (draggedRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
    draggedRef.current = false;
  }

  return { resizeOffsetPx, onPointerDown, longPressStyle, onClickCapture };
}
