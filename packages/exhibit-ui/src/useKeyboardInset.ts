import { useEffect, useState } from "react";

// How many px of the layout viewport's bottom edge are currently covered by
// something the visual viewport excludes - almost always a mobile on-screen
// keyboard. `position: fixed; bottom: 0` alone doesn't reliably sit above
// the keyboard on every mobile browser, so a fixed dropdown can end up
// rendered underneath it - out of view until the page happens to scroll.
// Falls back to 0 (no adjustment) where `visualViewport` isn't supported.
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    function update() {
      if (!vv) return;
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      setInset(Math.max(0, Math.round(covered)));
    }

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
