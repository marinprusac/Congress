import { useLongPressDrag } from "@congress/congress-ui";
import type { CalendarEvent } from "../../../src/types";

export interface EventContextMenuGestureResult {
  onPointerDown: (e: React.PointerEvent) => void;
  longPressStyle: React.CSSProperties;
  onContextMenu: (e: React.MouseEvent) => void;
}

// TODO: wire both openContextMenu callsites below to an actual context menu
// once one exists - for now this only reserves the gesture (suppresses the
// browser's own right-click menu and iOS's native touch-callout link
// preview, per useLongPressDrag's own style) and intentionally does nothing
// visible yet.
function openContextMenu(_event: CalendarEvent) {
  // Not built yet - see the TODO above.
}

// Long-press (touch/pen) or right-click (mouse) on an Agenda event block's
// own body, reserved for a context menu to be built later. Deliberately
// *not* `immediate` (see useLongPressDrag) - unlike the move/resize nudges,
// this listens on the block body itself, which still needs to disambiguate
// a genuine held press from the start of an ordinary scroll, exactly the
// case useLongPressDrag's default (non-immediate) touch/pen timing exists
// for. onDragMove/onDragEnd/onDragCancel are no-ops: this gesture never
// tracks a drag, it only decides once, on activation, whether a long enough
// press happened at all.
export function useEventContextMenuGesture(event: CalendarEvent): EventContextMenuGestureResult {
  const { onPointerDown, style: longPressStyle } = useLongPressDrag({
    onActivate: () => openContextMenu(event),
    onDragMove: () => {},
    onDragEnd: () => {},
  });

  function onContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    openContextMenu(event);
  }

  return { onPointerDown, longPressStyle, onContextMenu };
}
