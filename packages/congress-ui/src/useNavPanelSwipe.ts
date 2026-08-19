import { useEffect, useRef, useState } from "react";

// How close to the left edge (px) a touch has to start before it's eligible
// to open the panel - keeps this from hijacking horizontal gestures
// elsewhere on screen (list rows, carousels). Mirrors the "reserved gesture
// space" comment on `overscroll-behavior-x: none` in styles.css - iOS's own
// edge-swipe-back gesture used to live here and is now disabled in favor of
// this one.
const EDGE_ZONE_PX = 24;
const OPEN_THRESHOLD_PX = 60;
const CLOSE_THRESHOLD_PX = 40;

// Mobile-only off-canvas open/close state for NavPanel, driven by a
// right-swipe from the screen's left edge to open and a left-swipe (from
// anywhere on the open panel/backdrop) to close - there's no persistent
// toggle button. Desktop's own NavPanel variant is always visible via CSS
// alone and never reads `open`, so this hook is harmless (if unused) there.
export function useNavPanelSwipe(): { open: boolean; close: () => void } {
  const [open, setOpen] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const trackingRef = useRef(false);

  useEffect(() => {
    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0]!;
      if (!openRef.current && touch.clientX > EDGE_ZONE_PX) return;
      startRef.current = { x: touch.clientX, y: touch.clientY };
      trackingRef.current = true;
    }

    function onTouchMove(e: TouchEvent) {
      if (!trackingRef.current || !startRef.current) return;
      const touch = e.touches[0]!;
      const dx = touch.clientX - startRef.current.x;
      const dy = touch.clientY - startRef.current.y;
      // Once this reads as more vertical than horizontal, it's a scroll, not
      // a nav-panel swipe - stop tracking it rather than fighting the page.
      if (Math.abs(dy) > Math.abs(dx) * 1.5) {
        trackingRef.current = false;
        return;
      }
      if (!openRef.current && dx > OPEN_THRESHOLD_PX) {
        setOpen(true);
        trackingRef.current = false;
      } else if (openRef.current && dx < -CLOSE_THRESHOLD_PX) {
        setOpen(false);
        trackingRef.current = false;
      }
    }

    function onTouchEnd() {
      trackingRef.current = false;
      startRef.current = null;
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchEnd);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  return { open, close: () => setOpen(false) };
}
