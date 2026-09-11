import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLongPressDrag, showToast } from "@congress/congress-ui";
import { updateEvent } from "@/lib/api";
import { getBrowserTimeZone, PX_PER_QUARTER_HOUR, snappedDeltaMs, toDatetimeLocalInput } from "@/lib/datetime";
import type { CalendarEvent } from "../../../src/types";

// Patches every cached events list/solo entry the Agenda's own timeline
// (buildAgendaTimeline) reads from - shared between the optimistic write at
// drag-end and the mutation's own onSuccess/onError below, so a move and a
// rollback both go through the identical cache shape. Exported for
// useEventResizeDuration, which needs the identical patch against the same
// cache shape for its own start-fixed/end-only edit.
export function patchEventCache(queryClient: ReturnType<typeof useQueryClient>, updated: CalendarEvent) {
  queryClient.setQueriesData<{ events: CalendarEvent[] }>({ queryKey: ["events"], exact: false }, (old) => {
    if (!old || !Array.isArray(old.events)) return old;
    return {
      ...old,
      events: old.events.map((e) =>
        e.accountId === updated.accountId && e.calendarId === updated.calendarId && e.id === updated.id ? updated : e
      ),
    };
  });
  queryClient.setQueryData(["events", String(updated.accountId), updated.calendarId, updated.id], updated);
}

// Minimum raw pixel movement before a press reads as "actually dragging"
// rather than a still long-press or a plain click/tap - below this, the
// press falls through to its ordinary click/navigation behavior untouched,
// same outcome a plain tap already has (a long-press that never moves just
// opens the event, it doesn't silently swallow the tap).
const DRAG_ACTIVATE_PX = 3;

export interface EventDragRescheduleResult {
  dragOffsetPx: number;
  // The pending time shift (ms) implied by the current dragOffsetPx, snapped
  // to 15-minute steps - zero whenever dragOffsetPx is. The caller turns
  // this into whatever floating "new time" label its own markup shows.
  pendingMs: number;
  onPointerDown: (e: React.PointerEvent) => void;
  longPressStyle: React.CSSProperties;
  onClickCapture: (e: React.MouseEvent) => void;
}

// Drag-to-reschedule for a single Agenda event block, on top of the shared
// long-press-drag gesture (packages/congress-ui's useLongPressDrag): dragging
// up/down shifts the block by a 15-minute-snapped amount (see
// snappedDeltaMs), committed on release via the same updateEvent PATCH
// EventViewPage's own autosave already uses - not moveEvent, which is for
// reassigning calendar/account and would needlessly change the event's
// exhibit id, unrelated to a plain time shift. Always `immediate` (see
// useLongPressDrag) - the only touch/pen entry point left is the block's own
// right-edge move nudge (a small dedicated handle), never the block body
// itself, so there's nothing left to disambiguate from an ordinary scroll by
// waiting out a long-press first; the body's own long-press is a different,
// unrelated gesture now (see useEventContextMenuGesture).
//
// Extracted from DraggableEventBlock (the lone, non-overlapping case) so
// OverlapEventBlock - one block inside a genuinely overlapping cluster,
// AgendaPage's other cluster branch - can reuse the identical gesture/
// mutation wiring instead of a second hand-rolled copy; the two differ only
// in what markup they wrap it around (a single flow <Link> vs. a cluster's
// own absolutely-positioned paint+hit pair).
export function useEventDragReschedule(event: CalendarEvent): EventDragRescheduleResult {
  const queryClient = useQueryClient();
  const [dragOffsetPx, setDragOffsetPx] = useState(0);
  // Whether the current gesture ever moved past DRAG_ACTIVATE_PX - decides
  // both whether release commits a move and whether the resulting click
  // needs swallowing. Checked at click time via onClickCapture below rather
  // than relying on useLongPressDrag's own `dragging` flag, since this hook
  // is `immediate` (see above) and would otherwise swallow every ordinary
  // click/tap before it ever moves.
  const draggedRef = useRef(false);
  const durationMsRef = useRef(0);
  // The pre-drag event, captured on activation - lets onError roll the
  // optimistically-patched cache back to exactly what it displaced.
  const previousEventRef = useRef(event);

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
    // Re-patches with the server's own canonical response - idempotent
    // against the optimistic patch onDragEnd already made below, just here
    // to catch any server-side normalization. invalidateQueries then
    // refetches in the background to fully reconcile the fetched window.
    onSuccess: (updated) => {
      patchEventCache(queryClient, updated);
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
    onError: () => {
      patchEventCache(queryClient, previousEventRef.current);
      showToast("Failed to reschedule event.", "error");
    },
  });

  const { onPointerDown, style: longPressStyle } = useLongPressDrag({
    immediate: true,
    disabled: !event.editable,
    onActivate: () => {
      draggedRef.current = false;
      previousEventRef.current = event;
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
      // Patch the query cache with the real, snapped new start/end
      // synchronously, in the same tick dragOffsetPx resets to zero - the
      // Agenda's own timeline (buildAgendaTimeline, and its sqrt-scaled
      // durationPx/gapHeightPx) recomputes from that same render, so the
      // block is already at its true post-drop position (correct gap
      // heights, correct sort order) the instant the pointer lifts, rather
      // than sitting at a guessed pixel offset until moveMutation's network
      // round trip resolves and only then reflowing.
      const newStart = new Date(new Date(event.start).getTime() + deltaMs);
      const newEnd = new Date(newStart.getTime() + durationMsRef.current);
      patchEventCache(queryClient, {
        ...event,
        start: newStart.toISOString(),
        end: newEnd.toISOString(),
      });
      setDragOffsetPx(0);
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

  return { dragOffsetPx, pendingMs, onPointerDown, longPressStyle, onClickCapture };
}
