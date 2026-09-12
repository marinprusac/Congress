import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLongPressDrag, showToast } from "@congress/congress-ui";
import { updateEvent } from "@/lib/api";
import { clampResizeDeltaPx, getBrowserTimeZone, minutesBetween, PX_PER_QUARTER_HOUR, snappedDeltaMs, toDatetimeLocalInput } from "@/lib/datetime";
import type { CalendarEvent } from "../../../src/types";

// A tentative, not-yet-committed new time for one event, live during an
// active move/resize drag - AgendaPage substitutes this into the events
// array it feeds buildAgendaTimeline while a drag is in progress, so every
// other block/gap on the page reflows around the event's own tentative
// position live. Updated only once per PX_PER_QUARTER_HOUR-sized step
// actually crossed (not per raw pointermove) - see useAgendaDragController's
// own top comment for why that distinction matters.
export interface EventLivePreview {
  accountId: number;
  calendarId: string;
  id: string;
  mode: "move" | "resize";
  start: string;
  end: string;
}

// Patches every cached events list/solo entry the Agenda's own timeline
// (buildAgendaTimeline) reads from - shared between the optimistic write at
// drag-end and each mutation's own onSuccess/onError below, so a move, a
// resize, and a rollback of either all go through the identical cache shape.
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

interface EventIdentity {
  accountId: number;
  calendarId: string;
  id: string;
}

function sameEvent(a: EventIdentity, b: EventIdentity): boolean {
  return a.accountId === b.accountId && a.calendarId === b.calendarId && a.id === b.id;
}

function identityOf(event: CalendarEvent): EventIdentity {
  return { accountId: event.accountId, calendarId: event.calendarId, id: event.id };
}

// Minimum raw pixel movement before a press reads as "actually dragging"
// rather than a still long-press or a plain click/tap.
const DRAG_ACTIVATE_PX = 3;
const MIN_DURATION_MINUTES = 15;
// durationPx(MIN_DURATION_MINUTES) === this exactly (sqrt(15/60)*48 = 24) -
// not a coincidence worth re-deriving here, but the two floors (a duration
// floor and a legibility floor) happening to coincide is what lets the
// resize clamp below double as the on-screen pixel floor too. Exported so
// AgendaPage/OverlapEventBlock can suppress their own coarse height down to
// this same floor - never lower - while a resize is imperatively owning an
// element's real height, instead of redefining the constant a second time.
export const MIN_BLOCK_HEIGHT_PX = 24;

// Bounds how far the actively-dragged block's own painted position may
// drift from its coarse, reflowed slot (see moveSlotPageYRef) before the
// slot itself catches up. Without this, a drag over a stretch of the
// timeline that the reflow compresses much more tightly than the drag's own
// fixed linear time rate (see PX_PER_QUARTER_HOUR vs durationPx's sqrt
// scale) paints the block far down the page while the committed time delta
// stays tiny - "day borders don't move with the event", and the gap
// rows on either side of it never grow enough to keep the gutter's rule
// line underneath it, breaking the line. Sized to the same legibility floor
// as MIN_BLOCK_HEIGHT_PX - about one row's worth of drift - so short/local
// drags still feel perfectly 1:1 with the pointer; only a drag that's
// outrun a heavily-compressed stretch gets reined back to its true slot.
const MAX_MOVE_DRIFT_PX = MIN_BLOCK_HEIGHT_PX;

export interface EventDragBinding {
  isActiveMove: boolean;
  isActiveResize: boolean;
  // Absolute epoch ms for the currently pending (live, uncommitted) start/
  // end - null whenever nothing is pending yet (no step crossed). Taken
  // straight from livePreview, not computed as a delta added to this
  // block's own `event` prop - for the actively-dragged block, that prop is
  // already the live-substituted event (see AgendaPage's previewEvents), so
  // adding a delta on top of it would double the shift instead of just
  // showing it.
  pendingStartMs: number | null;
  pendingEndMs: number | null;
  onMovePointerDown: (e: React.PointerEvent) => void;
  onResizePointerDown: (e: React.PointerEvent) => void;
  moveStyle: React.CSSProperties;
  resizeStyle: React.CSSProperties;
  onClickCapture: (e: React.MouseEvent) => void;
}

export interface AgendaDragController {
  livePreview: EventLivePreview | null;
  forEvent(event: CalendarEvent): EventDragBinding;
  // Registers a DOM node as one of (possibly several - OverlapEventBlock's
  // paint+hit pair) the elements that should visually track the active move
  // drag. Callers gate this behind their own `binding.isActiveMove` in a
  // useLayoutEffect keyed on [binding.isActiveMove, controller.livePreview] -
  // isActiveMove so it (de)registers exactly when a drag starts/ends/moves
  // onto a differently-typed component (a cluster-membership change
  // unmounts/remounts the block - see this hook's own top comment), and
  // livePreview so a still-mounted block's own slot position gets
  // re-measured every time the reflow around it actually changes, not just
  // on (re)mount. Returns a cleanup (detach) function, ready to hand
  // straight back from that effect.
  attachMoveElement(el: HTMLElement): () => void;
  attachResizeElement(el: HTMLElement): () => void;
  // Must be called synchronously by the caller's own onPointerDown wrapper,
  // with the resize target's current (true, un-suppressed) rendered height,
  // strictly *before* delegating to EventDragBinding.onResizePointerDown -
  // see its own doc comment in the implementation for why the ordering
  // matters.
  primeResizeBaseHeight(heightPx: number): void;
}

interface MoveMutationVars {
  event: CalendarEvent;
  previousEvent: CalendarEvent;
  deltaMs: number;
}

interface ResizeMutationVars {
  event: CalendarEvent;
  previousEvent: CalendarEvent;
  newEndIso: string;
}

// A single, page-level owner for the Agenda's move/resize drag gesture -
// called once in AgendaPage, not once per rendered block, for two reasons:
//
// 1. Surviving a cluster-membership change mid-drag. AgendaPage's own live
//    preview (see EventLivePreview) can cause the actively-dragged event to
//    newly join - or leave - a genuinely-overlapping cluster mid-gesture,
//    which swaps which *component* renders it (DraggableEventBlock vs
//    OverlapEventBlock). When each of those owned its own useLongPressDrag
//    instance, that swap unmounted the hook instance driving the gesture -
//    its window pointermove/pointerup listeners vanished mid-drag, silently
//    abandoning it with no commit. Owning the gesture here instead - in
//    AgendaPage, which never unmounts for this reason - means the window
//    listeners survive any number of re-clusterings underneath it; only
//    which *element* currently represents the active event needs to update
//    (via attachMoveElement/attachResizeElement below), not who owns the
//    pointer-tracking itself.
//
// 2. Keeping every raw pointermove off the React render path. A drag needs
//    to track the pointer at native, per-frame granularity to look and feel
//    right - but AgendaPage's own re-render (from buildAgendaTimeline
//    re-running over the whole rendered window) is real work, and doing it
//    on every pixel of movement is what made dragging across a busy stretch
//    of the timeline feel "blocky" and made it lag badly near the
//    now-marker in particular (crossing it toggles a whole extra timeline
//    entry in and out, on top of the rest of the re-render). So only
//    `livePreview` and `moveGesture`/`resizeGesture` below - none of which
//    change more than once per PX_PER_QUARTER_HOUR-sized step, not per
//    pixel - go through React state at all. The raw, continuous part (the
//    actively-dragged element's own on-screen position/height) is written
//    straight to the DOM in onDragMove below, with no React render
//    involved, via whichever element(s) are currently registered through
//    attachMoveElement/attachResizeElement.
//
// Point 2 doubles as the fix for a second complaint: the dragged block only
// used to move by a residual sliver on top of wherever the sqrt-scaled
// layout put it, which is legible but not literally proportional to the
// finger - a 100px drag could move the block 30px or 300px depending on how
// compressed that stretch of the timeline happened to be. Since the
// imperative transform/height is computed straight from the raw pixel delta
// against the element's own measured position, the block's on-screen
// displacement now equals the pointer's own raw displacement, always,
// regardless of how the sqrt-scaled layout around it happens to compress or
// stretch that same span of time.
export function useAgendaDragController(): AgendaDragController {
  const queryClient = useQueryClient();

  const [livePreview, setLivePreview] = useState<EventLivePreview | null>(null);
  // Which event (by identity only, not the full object - see the refs below
  // for that) currently has an active move/resize gesture, from the instant
  // it activates (mousedown/long-press fires) until it ends - a strictly
  // wider window than livePreview's own (livePreview stays null until the
  // first snapped step is crossed). Blocks' own registration effects key
  // off this via isActiveMove/isActiveResize below, so an element gets
  // (de)registered exactly at activate/end, not delayed until the first
  // ~16px of movement the way relying on livePreview alone would.
  const [moveGesture, setMoveGesture] = useState<EventIdentity | null>(null);
  const [resizeGesture, setResizeGesture] = useState<EventIdentity | null>(null);

  const activeMoveEventRef = useRef<CalendarEvent | null>(null);
  const activeResizeEventRef = useRef<CalendarEvent | null>(null);
  const moveDraggedPastThresholdRef = useRef(false);
  const resizeDraggedPastThresholdRef = useRef(false);
  const lastMovePreviewMsRef = useRef<number | null>(null);
  const lastResizePreviewMsRef = useRef<number | null>(null);
  // Identifies whichever event a just-finished (past-threshold) drag
  // belongs to, so that specific block's own onClickCapture swallows the
  // click the release would otherwise also fire - cleared once read.
  const justDraggedRef = useRef<EventIdentity | null>(null);

  // Imperative move tracking - see the hook's own point 2 above.
  const activeMoveElsRef = useRef<Set<HTMLElement>>(new Set());
  const moveRawDeltaPxRef = useRef(0);
  const moveBasePageYRef = useRef(0);
  const moveSlotPageYRef = useRef(0);
  const moveJustActivatedRef = useRef(false);

  // Imperative resize tracking - the dragged block's own top never moves
  // (only its end does), so unlike move there's no "slot" to re-measure
  // mid-gesture - the base height captured once at activation, plus the raw
  // delta, is the whole story for the rest of the gesture.
  const activeResizeElsRef = useRef<Set<HTMLElement>>(new Set());
  const resizeRawDeltaPxRef = useRef(0);
  const resizeBaseHeightPxRef = useRef(0);
  // Set by the caller's own onPointerDown wrapper (see primeResizeBaseHeight)
  // *before* the gesture activates - measuring inside attachResizeElement
  // instead (after activation) would read the box's height only after
  // AgendaPage/OverlapEventBlock had already suppressed their own coarse
  // height in response to isActiveResize turning true, collapsing it to
  // MIN_BLOCK_HEIGHT_PX before anything got a chance to measure the real one.
  const resizePrimedHeightPxRef = useRef(0);

  function applyMoveTransform() {
    const rawOffsetPx = moveBasePageYRef.current + moveRawDeltaPxRef.current - moveSlotPageYRef.current;
    const offsetPx = Math.max(-MAX_MOVE_DRIFT_PX, Math.min(MAX_MOVE_DRIFT_PX, rawOffsetPx));
    const transform = offsetPx ? `translateY(${offsetPx}px)` : "";
    for (const el of activeMoveElsRef.current) el.style.transform = transform;
  }

  // Used at gesture end/cancel instead of applyMoveTransform()/
  // applyResizeHeight() - by that point basePageY/slotPageY (or the primed
  // base height) no longer describe anything meaningful, so computing
  // "what the transform/height should be" would just produce a stale value
  // for the brief window before the registration effect's own cleanup
  // clears it anyway. Clearing directly here is simpler and doesn't depend
  // on that cleanup's own flush timing.
  function clearMoveElements() {
    for (const el of activeMoveElsRef.current) el.style.transform = "";
  }
  function clearResizeElements() {
    for (const el of activeResizeElsRef.current) el.style.height = "";
  }

  function applyResizeHeight() {
    const heightPx = Math.max(MIN_BLOCK_HEIGHT_PX, resizeBaseHeightPxRef.current + resizeRawDeltaPxRef.current);
    for (const el of activeResizeElsRef.current) el.style.height = `${heightPx}px`;
  }

  function attachMoveElement(el: HTMLElement): () => void {
    activeMoveElsRef.current.add(el);
    const pageY = el.getBoundingClientRect().top + window.scrollY;
    if (moveJustActivatedRef.current) {
      moveBasePageYRef.current = pageY;
      moveJustActivatedRef.current = false;
    }
    moveSlotPageYRef.current = pageY;
    applyMoveTransform();
    return () => {
      activeMoveElsRef.current.delete(el);
      el.style.transform = "";
    };
  }

  function attachResizeElement(el: HTMLElement): () => void {
    activeResizeElsRef.current.add(el);
    applyResizeHeight();
    return () => {
      activeResizeElsRef.current.delete(el);
      el.style.height = "";
    };
  }

  // Called by the block's own onPointerDown wrapper, synchronously and
  // strictly before it delegates to EventDragBinding.onResizePointerDown -
  // i.e. while the target element still has its true, un-suppressed
  // duration-scaled height, since nothing has re-rendered yet at that point.
  function primeResizeBaseHeight(heightPx: number) {
    resizePrimedHeightPxRef.current = heightPx;
  }

  const moveMutation = useMutation({
    mutationFn: ({ event, deltaMs }: MoveMutationVars) => {
      const durationMs = new Date(event.end).getTime() - new Date(event.start).getTime();
      const newStart = new Date(new Date(event.start).getTime() + deltaMs);
      const newEnd = new Date(newStart.getTime() + durationMs);
      return updateEvent(event.accountId, event.calendarId, event.id, {
        start: toDatetimeLocalInput(newStart.toISOString()),
        end: toDatetimeLocalInput(newEnd.toISOString()),
        allDay: false,
        timeZone: getBrowserTimeZone(),
      });
    },
    onSuccess: (updated) => {
      patchEventCache(queryClient, updated);
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
    onError: (_err, variables: MoveMutationVars) => {
      patchEventCache(queryClient, variables.previousEvent);
      showToast("Failed to reschedule event.", "error");
    },
  });

  const resizeMutation = useMutation({
    mutationFn: ({ event, newEndIso }: ResizeMutationVars) =>
      updateEvent(event.accountId, event.calendarId, event.id, {
        start: toDatetimeLocalInput(event.start),
        end: toDatetimeLocalInput(newEndIso),
        allDay: false,
        timeZone: getBrowserTimeZone(),
      }),
    onSuccess: (updated) => {
      patchEventCache(queryClient, updated);
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
    onError: (_err, variables: ResizeMutationVars) => {
      patchEventCache(queryClient, variables.previousEvent);
      showToast("Failed to resize event.", "error");
    },
  });

  const move = useLongPressDrag({
    immediate: true,
    onActivate: () => {
      const event = activeMoveEventRef.current;
      if (!event) return;
      moveDraggedPastThresholdRef.current = false;
      lastMovePreviewMsRef.current = null;
      moveRawDeltaPxRef.current = 0;
      moveJustActivatedRef.current = true;
      setMoveGesture(identityOf(event));
      applyMoveTransform();
    },
    onDragMove: (deltaPx) => {
      const event = activeMoveEventRef.current;
      if (!event) return;
      if (Math.abs(deltaPx) >= DRAG_ACTIVATE_PX) moveDraggedPastThresholdRef.current = true;
      moveRawDeltaPxRef.current = deltaPx;
      applyMoveTransform();
      if (!moveDraggedPastThresholdRef.current) return;
      const snappedMs = snappedDeltaMs(deltaPx, PX_PER_QUARTER_HOUR, 15);
      if (snappedMs === lastMovePreviewMsRef.current) return;
      lastMovePreviewMsRef.current = snappedMs;
      if (snappedMs === 0) {
        setLivePreview(null);
        return;
      }
      const durationMs = new Date(event.end).getTime() - new Date(event.start).getTime();
      const newStart = new Date(new Date(event.start).getTime() + snappedMs);
      const newEnd = new Date(newStart.getTime() + durationMs);
      setLivePreview({
        accountId: event.accountId,
        calendarId: event.calendarId,
        id: event.id,
        mode: "move",
        start: newStart.toISOString(),
        end: newEnd.toISOString(),
      });
    },
    onDragEnd: (deltaPx) => {
      const event = activeMoveEventRef.current;
      setLivePreview(null);
      setMoveGesture(null);
      lastMovePreviewMsRef.current = null;
      moveRawDeltaPxRef.current = 0;
      clearMoveElements();
      if (!event || !moveDraggedPastThresholdRef.current) {
        moveDraggedPastThresholdRef.current = false;
        return;
      }
      moveDraggedPastThresholdRef.current = false;
      justDraggedRef.current = identityOf(event);
      const deltaMs = snappedDeltaMs(deltaPx, PX_PER_QUARTER_HOUR, 15);
      if (deltaMs === 0) return;
      // Patch the query cache with the real, snapped new start/end
      // synchronously - the Agenda's own timeline (buildAgendaTimeline, and
      // its sqrt-scaled durationPx/gapHeightPx) recomputes from that same
      // render, so the block is already at its true post-drop position the
      // instant the pointer lifts, rather than sitting at a guessed offset
      // until the PATCH round trip resolves.
      const durationMs = new Date(event.end).getTime() - new Date(event.start).getTime();
      const newStart = new Date(new Date(event.start).getTime() + deltaMs);
      const newEnd = new Date(newStart.getTime() + durationMs);
      patchEventCache(queryClient, { ...event, start: newStart.toISOString(), end: newEnd.toISOString() });
      moveMutation.mutate({ event, previousEvent: event, deltaMs });
    },
    onDragCancel: () => {
      setLivePreview(null);
      setMoveGesture(null);
      lastMovePreviewMsRef.current = null;
      moveDraggedPastThresholdRef.current = false;
      moveRawDeltaPxRef.current = 0;
      clearMoveElements();
    },
  });

  const resize = useLongPressDrag({
    immediate: true,
    onActivate: () => {
      const event = activeResizeEventRef.current;
      if (!event) return;
      resizeDraggedPastThresholdRef.current = false;
      lastResizePreviewMsRef.current = null;
      resizeRawDeltaPxRef.current = 0;
      resizeBaseHeightPxRef.current = resizePrimedHeightPxRef.current;
      setResizeGesture(identityOf(event));
      applyResizeHeight();
    },
    onDragMove: (deltaPx) => {
      const event = activeResizeEventRef.current;
      if (!event) return;
      if (Math.abs(deltaPx) >= DRAG_ACTIVATE_PX) resizeDraggedPastThresholdRef.current = true;
      const durationMinutes = minutesBetween(event.start, event.end);
      const clampedPx = clampResizeDeltaPx(deltaPx, durationMinutes, PX_PER_QUARTER_HOUR, 15, MIN_DURATION_MINUTES);
      resizeRawDeltaPxRef.current = clampedPx;
      applyResizeHeight();
      if (!resizeDraggedPastThresholdRef.current) return;
      const snappedMs = snappedDeltaMs(clampedPx, PX_PER_QUARTER_HOUR, 15);
      if (snappedMs === lastResizePreviewMsRef.current) return;
      lastResizePreviewMsRef.current = snappedMs;
      if (snappedMs === 0) {
        setLivePreview(null);
        return;
      }
      const newEnd = new Date(new Date(event.end).getTime() + snappedMs);
      setLivePreview({ accountId: event.accountId, calendarId: event.calendarId, id: event.id, mode: "resize", start: event.start, end: newEnd.toISOString() });
    },
    onDragEnd: (deltaPx) => {
      const event = activeResizeEventRef.current;
      setLivePreview(null);
      setResizeGesture(null);
      lastResizePreviewMsRef.current = null;
      resizeRawDeltaPxRef.current = 0;
      clearResizeElements();
      if (!event || !resizeDraggedPastThresholdRef.current) {
        resizeDraggedPastThresholdRef.current = false;
        return;
      }
      resizeDraggedPastThresholdRef.current = false;
      justDraggedRef.current = identityOf(event);
      const durationMinutes = minutesBetween(event.start, event.end);
      const clampedPx = clampResizeDeltaPx(deltaPx, durationMinutes, PX_PER_QUARTER_HOUR, 15, MIN_DURATION_MINUTES);
      const deltaMs = snappedDeltaMs(clampedPx, PX_PER_QUARTER_HOUR, 15);
      if (deltaMs === 0) return;
      const newEnd = new Date(new Date(event.end).getTime() + deltaMs);
      patchEventCache(queryClient, { ...event, end: newEnd.toISOString() });
      resizeMutation.mutate({ event, previousEvent: event, newEndIso: newEnd.toISOString() });
    },
    onDragCancel: () => {
      setLivePreview(null);
      setResizeGesture(null);
      lastResizePreviewMsRef.current = null;
      resizeDraggedPastThresholdRef.current = false;
      resizeRawDeltaPxRef.current = 0;
      clearResizeElements();
    },
  });

  function forEvent(event: CalendarEvent): EventDragBinding {
    const isActiveMove = moveGesture !== null && sameEvent(moveGesture, event);
    const isActiveResize = resizeGesture !== null && sameEvent(resizeGesture, event);

    function onMovePointerDown(e: React.PointerEvent) {
      if (!event.editable) return;
      activeMoveEventRef.current = event;
      move.onPointerDown(e);
    }
    function onResizePointerDown(e: React.PointerEvent) {
      if (!event.editable) return;
      activeResizeEventRef.current = event;
      resize.onPointerDown(e);
    }
    function onClickCapture(e: React.MouseEvent) {
      const just = justDraggedRef.current;
      if (just && sameEvent(just, event)) {
        e.preventDefault();
        e.stopPropagation();
        justDraggedRef.current = null;
      }
    }

    // Absolute values straight from livePreview - see EventDragBinding's own
    // doc comment for why these must not be computed as a delta added back
    // onto this `event` parameter.
    const pendingStartMs = isActiveMove && livePreview ? new Date(livePreview.start).getTime() : null;
    const pendingEndMs = (isActiveMove || isActiveResize) && livePreview ? new Date(livePreview.end).getTime() : null;

    return {
      isActiveMove,
      isActiveResize,
      pendingStartMs,
      pendingEndMs,
      onMovePointerDown,
      onResizePointerDown,
      moveStyle: move.style,
      resizeStyle: resize.style,
      onClickCapture,
    };
  }

  return { livePreview, forEvent, attachMoveElement, attachResizeElement, primeResizeBaseHeight };
}
