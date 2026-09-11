// The two small "nudge" handles an Agenda event block grows on touch, once
// its own long-press is reserved for a future context menu instead of
// drag-to-reschedule (see useEventContextMenuGesture): a right-middle handle
// for moving the event (shifting its start, duration preserved - the same
// gesture the whole block used to support from anywhere) and a bottom-middle
// handle for resizing it (changing its duration, start fixed). Both are
// small, dedicated touch targets deliberately, not the whole block, so an
// ordinary scroll/tap over the rest of the block is never mistaken for one.
//
// Mobile-first, per this app's own convention (see CLAUDE.md): the base
// (unprefixed) classes below are the touch/mobile appearance, and `sm:`
// layers a desktop override on top - never the other way around.
//
// On desktop there's no need to show either - the block body itself still
// drags to move from anywhere (see the body's own onPointerDown in
// DraggableEventBlock/OverlapEventBlock), and only the resize handle needs
// to exist at all, widened at `sm:` to span the block's whole bottom border
// (not just its mobile pill's own narrow footprint) so "hover the bottom
// border, see the resize cursor" works wherever along that border the mouse
// actually is.
//
// Both handles stop the pointerdown from bubbling to the block body's own
// handler before delegating to their hook's onPointerDown - without it, the
// body's own move-drag (mouse) or context-menu long-press (touch) would also
// fire for the same press.

interface EventDragHandleProps {
  onPointerDown: (e: React.PointerEvent) => void;
  style: React.CSSProperties;
}

export function EventMoveHandle({ onPointerDown, style }: EventDragHandleProps) {
  function handlePointerDown(e: React.PointerEvent) {
    e.stopPropagation();
    onPointerDown(e);
  }

  return (
    <div
      aria-hidden="true"
      onPointerDown={handlePointerDown}
      className="absolute right-0 top-1/2 z-30 flex h-6 w-6 -translate-y-1/2 translate-x-1/2 items-center justify-center sm:hidden"
      style={style}
    >
      <span className="h-2.5 w-2.5 rounded-full border border-accent bg-parchment" />
    </div>
  );
}

export function EventResizeHandle({ onPointerDown, style }: EventDragHandleProps) {
  function handlePointerDown(e: React.PointerEvent) {
    e.stopPropagation();
    onPointerDown(e);
  }

  return (
    <div
      aria-hidden="true"
      onPointerDown={handlePointerDown}
      className="absolute bottom-0 left-1/2 z-30 flex h-4 w-10 -translate-x-1/2 translate-y-1/2 items-center justify-center sm:inset-x-0 sm:left-0 sm:w-auto sm:translate-x-0"
      style={{ cursor: "ns-resize", ...style }}
    >
      <span className="h-1.5 w-8 rounded-full border border-accent bg-parchment sm:hidden" />
    </div>
  );
}
