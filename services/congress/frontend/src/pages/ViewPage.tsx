import { useParams } from "react-router-dom";
import { ChamberHeader, ChamberMark, useAppliedTheme, useBackNavigation } from "@congress/congress-ui";
import { ViewSlot } from "@/components/ViewSlot";
import { findCoreView } from "@/views/coreViews";

// A view card with no full-screen page of its own, opened on its own - the
// same card as in the feed, given the whole screen.
export function ViewPage() {
  useAppliedTheme();
  const { chamber = "", viewId = "" } = useParams();
  const core = findCoreView(chamber, viewId);
  const back = useBackNavigation();

  return (
    <div className="chamber-shell">
      <ChamberHeader icon={<ChamberMark name={chamber} className="h-6 w-6 text-ink" />} title={core?.source.displayName ?? chamber} titleHref="" onBack={back} />
      <main className="chamber-main">
        {core?.view.Card ? (
          <ViewSlot source={core.source} view={core.view} Card={core.view.Card} full />
        ) : (
          <p className="font-mono text-sm text-dust">— This view isn't available —</p>
        )}
      </main>
    </div>
  );
}
