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

// Tracks a downward touch-drag starting from window.scrollY === 0 - the
// same gesture space a standalone PWA's missing native pull-to-refresh
// would otherwise leave unused. `zone`/`progress` drive MobileSearchReveal's
// indicator; `onRelease` fires once, with whichever zone the drag was in
// when the finger lifted.
export function usePullGesture({ onRelease }: UsePullGestureOptions): { zone: PullZone; progress: number } {
  const [zone, setZone] = useState<PullZone>("idle");
  const [progress, setProgress] = useState(0);
  const zoneRef = useRef<PullZone>("idle");
  const startYRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const onReleaseRef = useRef(onRelease);
  onReleaseRef.current = onRelease;

  function reset() {
    draggingRef.current = false;
    startYRef.current = null;
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
      if (window.scrollY > 0 || e.touches.length !== 1) return;
      // A full-bleed draggable surface near the top of the page (a Leaflet
      // map, say) has its own meaning for a downward drag - opt it out via
      // this attribute rather than letting this window-level listener steal
      // the gesture out from under it.
      const target = e.target;
      if (target instanceof Element && target.closest("[data-pull-gesture-ignore]")) return;
      startYRef.current = e.touches[0]!.clientY;
      draggingRef.current = true;
      window.addEventListener("touchmove", onTouchMove, { passive: false });
    }

    function onTouchMove(e: TouchEvent) {
      if (!draggingRef.current || startYRef.current === null) return;
      const delta = e.touches[0]!.clientY - startYRef.current;
      if (delta <= 0 || window.scrollY > 0) {
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
