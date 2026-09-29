import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useLocation } from "react-router-dom";
import { flipDeltas, markRouteCommitted, prefersReducedMotion, presenceStep, type Box } from "./motion.js";

// Mounted once inside the shell's Router: tells a pending page transition
// that the new route has committed to the DOM.
export function RouteCommitSignal() {
  const location = useLocation();
  useLayoutEffect(() => {
    markRouteCommitted();
  }, [location.key]);
  return null;
}

// Keeps something mounted through its exit animation: render while `mounted`,
// put `state` on `data-state` and let CSS animate "open"/"closing".
export function usePresence(open: boolean, exitMs = 200): { mounted: boolean; state: "open" | "closing" } {
  const [presence, setPresence] = useState({ prevOpen: open, closing: false });
  const next = presenceStep(presence, open);
  if (next !== presence) setPresence(next);

  useEffect(() => {
    if (!next.closing) return;
    const timer = setTimeout(() => setPresence((p) => (p.closing ? { ...p, closing: false } : p)), prefersReducedMotion() ? 0 : exitMs);
    return () => clearTimeout(timer);
  }, [next.closing, exitMs]);

  return { mounted: open || next.closing, state: open ? "open" : "closing" };
}

// Layout offsets, not client rects, so a running animation's translate and
// the page's scroll don't skew the snapshot.
function measure(container: HTMLElement): Map<string, Box> {
  const boxes = new Map<string, Box>();
  for (const el of container.querySelectorAll<HTMLElement>(":scope > [data-flip-key]")) {
    boxes.set(el.dataset.flipKey!, { top: el.offsetTop, left: el.offsetLeft });
  }
  return boxes;
}

// Glides a list's direct children (each with `data-flip-key`) to their new
// positions when `keys` change, and fades in new ones. The container must be
// positioned (it's the children's offsetParent).
export function useFlipList(containerRef: RefObject<HTMLElement | null>, keys: readonly string[], durationMs = 280): void {
  const boxes = useRef<Map<string, Box> | null>(null);
  const signature = keys.join("\u0000");

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const next = measure(container);
    const prev = boxes.current;
    boxes.current = next;
    if (!prev || prev.size === 0 || prefersReducedMotion() || typeof container.animate !== "function") return;
    const { moved, entered } = flipDeltas(prev, next);
    const byKey = (key: string) => container.querySelector<HTMLElement>(`:scope > [data-flip-key="${CSS.escape(key)}"]`);
    for (const { key, dx, dy } of moved) {
      byKey(key)?.animate([{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }], { duration: durationMs, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
    }
    for (const key of entered) {
      byKey(key)?.animate([{ opacity: 0, scale: "0.98" }, { opacity: 1, scale: "1" }], { duration: durationMs, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
    }
  }, [signature, containerRef, durationMs]);

  // Content inside items can resize between renders (a view card loading);
  // keep the snapshot current so the next reorder starts from the truth.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      boxes.current = measure(container);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef]);
}
