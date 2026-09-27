// Called once from every app's main.tsx. The page never zooms (see also the
// viewport meta and styles.css's touch-action); the Map's own pinch still
// works since Leaflet reads the touches itself.
export function preventPinchZoom(): void {
  const block = (event: Event) => event.preventDefault();
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
    document.addEventListener(type, block, { passive: false });
  }
  document.addEventListener(
    "touchmove",
    (event) => {
      if (event.touches.length > 1) event.preventDefault();
    },
    { passive: false }
  );
}
