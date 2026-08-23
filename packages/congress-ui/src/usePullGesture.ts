import { useEffect, useRef, useState } from "react";

export type PullZone = "idle" | "search" | "refresh";

// How far (px) a downward drag from the very top of the page has to travel
// before it counts as reaching each zone - see MobileSearchReveal for what
// happens on release in each one.
const SEARCH_THRESHOLD = 90;
const REFRESH_THRESHOLD = 220;

interface UsePullGestureOptions {
  onRelease: (zone: PullZone) => void;
}

// The nearest ancestor (starting at the touch target itself) that's
// actually vertically scrollable - a Chamber with its own internal scroll
// region below a fixed header (Deputy's Chat page, see its own Layout
// comment on chamber-shell--canvas) never scrolls the *document* at all, so
// window.scrollY stays permanently 0 there regardless of how far down the
// chat itself is scrolled. Without this, a pull-down gesture starting
// mid-conversation - not at the top of the message list, just wherever the
// finger happens to land - read as "top of the page" and hijacked the
// gesture from the chat's own scrolling. Returns null when nothing between
// the target and the document scrolls on its own, meaning the document
// itself is the relevant scroll container (the pre-existing behavior below
// falls back to window.scrollY in that case).
function findScrollParent(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  let el: Element | null = target;
  while (el && el !== document.body && el !== document.documentElement) {
    if (el.scrollHeight > el.clientHeight) {
      const overflowY = getComputedStyle(el).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") return el;
    }
    el = el.parentElement;
  }
  return null;
}

function scrollTopOf(scrollParent: Element | null): number {
  return scrollParent ? scrollParent.scrollTop : window.scrollY;
}

// Tracks a downward touch-drag starting from the top of whatever's actually
// scrollable under the finger (findScrollParent) - the same gesture space a
// standalone PWA's missing native pull-to-refresh would otherwise leave
// unused. `zone`/`progress` drive MobileSearchReveal's indicator;
// `onRelease` fires once, with whichever zone the drag was in when the
// finger lifted.
export function usePullGesture({ onRelease }: UsePullGestureOptions): { zone: PullZone; progress: number } {
  const [zone, setZone] = useState<PullZone>("idle");
  const [progress, setProgress] = useState(0);
  const zoneRef = useRef<PullZone>("idle");
  const startYRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  // Whichever scrollable ancestor (if any) the current drag's touch target
  // landed in - resolved once at touchstart, then re-checked on every
  // touchmove the same way window.scrollY always was, in case the drag
  // itself is what's scrolling it back away from the top.
  const scrollParentRef = useRef<Element | null>(null);
  const onReleaseRef = useRef(onRelease);
  onReleaseRef.current = onRelease;

  function reset() {
    draggingRef.current = false;
    startYRef.current = null;
    scrollParentRef.current = null;
    zoneRef.current = "idle";
    setZone("idle");
    setProgress(0);
  }

  function applyDelta(delta: number) {
    const nextZone: PullZone =
      delta >= REFRESH_THRESHOLD ? "refresh" : delta >= SEARCH_THRESHOLD ? "search" : "idle";
    zoneRef.current = nextZone;
    setZone(nextZone);
    setProgress(Math.min(1, delta / REFRESH_THRESHOLD));
  }

  useEffect(() => {
    // A non-passive touchmove listener tells the browser it may call
    // preventDefault, which forces the compositor to wait for this handler
    // before it can scroll *anything* in the app - not just this gesture.
    // Registered only for the lifetime of a qualifying drag (added once
    // onTouchStart accepts it, removed on release/reset) instead of for the
    // whole mounted lifetime of this hook, so every other scroll in the app
    // stays compositor-only the rest of the time.
    function stopTracking() {
      window.removeEventListener("touchmove", onTouchMove);
      reset();
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      // A full-bleed draggable surface near the top of the page (a Leaflet
      // map, say) has its own meaning for a downward drag - opt it out via
      // this attribute rather than letting this window-level listener steal
      // the gesture out from under it.
      const target = e.target;
      if (target instanceof Element && target.closest("[data-pull-gesture-ignore]")) return;
      const scrollParent = findScrollParent(target);
      if (scrollTopOf(scrollParent) > 0) return;
      scrollParentRef.current = scrollParent;
      startYRef.current = e.touches[0]!.clientY;
      draggingRef.current = true;
      window.addEventListener("touchmove", onTouchMove, { passive: false });
    }

    function onTouchMove(e: TouchEvent) {
      if (!draggingRef.current || startYRef.current === null) return;
      const delta = e.touches[0]!.clientY - startYRef.current;
      if (delta <= 0 || scrollTopOf(scrollParentRef.current) > 0) {
        stopTracking();
        return;
      }
      // Only hijack the gesture once it's unambiguously a downward pull from
      // the top - otherwise leave normal scrolling/touch behavior alone.
      e.preventDefault();
      applyDelta(delta);
    }

    function onTouchEnd() {
      if (draggingRef.current && zoneRef.current !== "idle") onReleaseRef.current(zoneRef.current);
      stopTracking();
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchEnd);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  return { zone, progress };
}
