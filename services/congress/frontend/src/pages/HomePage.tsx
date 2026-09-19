import { useState } from "react";
import { ChamberHeader, CapitolMark, useAppliedTheme } from "@congress/congress-ui";
import { Canvas } from "@/components/Canvas";

// Congress's own landing page - the cell-based widget canvas every Chamber
// contributes widgets to. Not a registered Chamber: it's core Congress, so
// it works with zero Chambers registered. Only this route needs to be a
// finite, unscrollable, viewport-locked surface (styles.css's
// .chamber-shell--canvas); every other route stays an ordinary page.
export function HomePage() {
  useAppliedTheme();
  const [editing, setEditing] = useState(false);

  return (
    <div className="chamber-shell chamber-shell--canvas">
      <ChamberHeader icon={<CapitolMark className="h-6 w-6 text-ink" />} title="Home" titleHref="" />
      <main className="chamber-main chamber-main--canvas">
        <Canvas editing={editing} onToggleEditing={() => setEditing((e) => !e)} />
      </main>
    </div>
  );
}
