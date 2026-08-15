import { useEffect, useRef, useState } from "react";

export type PullZone = "idle" | "search" | "refresh";

// How far (px) a downward drag from the very top of the page has to travel
// before it counts as reaching each zone - see MobileSearchReveal for what
// happens on release in each one.
const SEARCH_THRESHOLD = 50;
const REFRESH_THRESHOLD = 140;

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

  useEffect(() => {
    function onTouchStart(e: TouchEvent) {
      if (window.scrollY > 0 || e.touches.length !== 1) return;
      startYRef.current = e.touches[0]!.clientY;
      draggingRef.current = true;
    }

    function onTouchMove(e: TouchEvent) {
      if (!draggingRef.current || startYRef.current === null) return;
      const delta = e.touches[0]!.clientY - startYRef.current;
      if (delta <= 0 || window.scrollY > 0) {
        reset();
        return;
      }
      // Only hijack the gesture once it's unambiguously a downward pull from
      // the top - otherwise leave normal scrolling/touch behavior alone.
      e.preventDefault();
      const nextZone: PullZone =
        delta >= REFRESH_THRESHOLD ? "refresh" : delta >= SEARCH_THRESHOLD ? "search" : "idle";
      zoneRef.current = nextZone;
      setZone(nextZone);
      setProgress(Math.min(1, delta / REFRESH_THRESHOLD));
    }

    function onTouchEnd() {
      if (draggingRef.current && zoneRef.current !== "idle") onReleaseRef.current(zoneRef.current);
      reset();
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
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
