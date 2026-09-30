import { useEffect } from "react";
import { useMap } from "react-leaflet";

// Leaflet measures its container once, at init, and only re-measures on a
// window resize - not when the container itself changes size. A map that
// mounts before its container has its final size (a canvas widget still
// laying out when the shell swaps back to the homepage, a panel that
// animates open) therefore keeps rendering tiles for the stale, smaller
// size: a blank grey region until something forces a re-measure, like a
// page refresh. Watching the container directly fixes every such case.
export function InvalidateSizeOnResize() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);
    // Also once right away - the container can already have settled by the
    // time this effect runs, in which case the observer's first (initial)
    // callback is all that fires, but an explicit call is cheap insurance.
    map.invalidateSize();
    return () => observer.disconnect();
  }, [map]);
  return null;
}
