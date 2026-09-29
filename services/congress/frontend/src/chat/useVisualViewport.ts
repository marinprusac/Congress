import { useEffect } from "react";

// Publishes the visual viewport (the part not covered by the on-screen
// keyboard) as --vv-top/--vv-height, so the chat can pin its composer above
// the keyboard on iOS, where 100dvh ignores it.
export function useVisualViewportVars(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    if (!vv) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        root.style.setProperty("--vv-top", `${Math.max(0, vv.offsetTop)}px`);
        root.style.setProperty("--vv-height", `${vv.height}px`);
      });
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      root.style.removeProperty("--vv-top");
      root.style.removeProperty("--vv-height");
    };
  }, []);
}

// While the composer is focused on a phone the tab bar hides (the keyboard
// covers it anyway), handing its space to the conversation.
export function setComposing(on: boolean): void {
  document.documentElement.classList.toggle("chat-composing", on);
  // iOS can leave the page scrolled after the keyboard closes; the chat never scrolls the window.
  if (!on && window.scrollY !== 0) window.scrollTo(0, 0);
}
