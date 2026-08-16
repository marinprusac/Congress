import { useEffect, useRef, type RefObject } from "react";
import { WIDGET_PULL_MESSAGE, type WidgetPullMessage } from "./usePullGesture.js";

// Broadcast from WidgetGrid (the parent) into every widget iframe whenever
// the homepage's own scroll position crosses the top boundary - the iframe
// has no other way to know this (window.scrollY inside it only ever
// describes its own, unrelated document). Without it, a widget with a short
// list (scrollTop always 0) can't tell "page is at the top, a pull-down
// here should become the search/refresh gesture" apart from "page is
// scrolled down, this same drag should just scroll the page back up" - see
// WidgetGrid.tsx's broadcastScrollTop.
export const PAGE_SCROLL_TOP_MESSAGE = "congress:page-scroll-top";

export interface PageScrollTopMessage {
  type: typeof PAGE_SCROLL_TOP_MESSAGE;
  atTop: boolean;
}

// WidgetPreviewShell runs inside Capitol homepage's <iframe> - a downward
// drag starting over it lives entirely in this document's own browsing
// context, so it never reaches the parent's usePullGesture listeners
// (touch events don't cross an iframe boundary). This forwards the exact
// same "drag down from this list's own scroll-top" gesture via postMessage,
// so a pull started over a widget still drives the parent page's
// search/refresh indicator instead of silently rubber-banding the widget's
// own list in place.
//
// It only ever intercepts the gesture once the parent has confirmed (via
// PAGE_SCROLL_TOP_MESSAGE) that the page itself is scrolled to the top -
// otherwise a drag over the widget is left as an ordinary touch, so it can
// still natively scroll/chain the parent page (e.g. scrolling back up after
// reaching the bottom, dragging down over a widget along the way).
export function useWidgetPullBridge(scrollRef: RefObject<HTMLElement | null>): void {
  const startYRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const pageAtTopRef = useRef(false);

  useEffect(() => {
    if (window.parent === window) return; // not embedded - nothing to bridge

    function post(message: WidgetPullMessage) {
      window.parent.postMessage(message, "*");
    }

    function endBridge() {
      if (draggingRef.current) post({ type: WIDGET_PULL_MESSAGE, phase: "end" });
      draggingRef.current = false;
      startYRef.current = null;
    }

    function onTouchStart(e: TouchEvent) {
      const el = scrollRef.current;
      if (!pageAtTopRef.current || !el || el.scrollTop > 0 || e.touches.length !== 1) return;
      startYRef.current = e.touches[0]!.clientY;
      draggingRef.current = true;
      post({ type: WIDGET_PULL_MESSAGE, phase: "start" });
    }

    function onTouchMove(e: TouchEvent) {
      if (!draggingRef.current || startYRef.current === null) return;
      const delta = e.touches[0]!.clientY - startYRef.current;
      const el = scrollRef.current;
      if (delta <= 0 || (el && el.scrollTop > 0)) {
        endBridge();
        return;
      }
      // Stop this list's own native bounce while the parent page drives the
      // visible indicator for the bridged gesture instead.
      e.preventDefault();
      post({ type: WIDGET_PULL_MESSAGE, phase: "move", deltaY: delta });
    }

    function onScrollTopMessage(e: MessageEvent) {
      const data = e.data as Partial<PageScrollTopMessage> | undefined;
      if (!data || data.type !== PAGE_SCROLL_TOP_MESSAGE) return;
      pageAtTopRef.current = Boolean(data.atTop);
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", endBridge);
    window.addEventListener("touchcancel", endBridge);
    window.addEventListener("message", onScrollTopMessage);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", endBridge);
      window.removeEventListener("touchcancel", endBridge);
      window.removeEventListener("message", onScrollTopMessage);
    };
  }, [scrollRef]);
}
