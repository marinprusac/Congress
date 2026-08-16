// Every app's own main.tsx calls this once, before its first render (same
// shape as markShellHosted() in ShellHostContext.ts). Blocks pinch-zoom in
// standalone iOS PWAs - CSS `touch-action` (see styles.css) stops
// double-tap-zoom fine, but iOS Safari doesn't honor touch-action for
// pinch, only this WebKit-only gesture event actually prevents it.
export function preventPinchZoom(): void {
  document.addEventListener(
    "gesturestart",
    (event) => {
      event.preventDefault();
    },
    { passive: false }
  );
}
