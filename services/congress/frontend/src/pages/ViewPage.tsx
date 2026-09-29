import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChamberHeader, ChamberMark, fetchRegistry, useAppliedTheme, useBackNavigation } from "@congress/congress-ui";
import { ViewSlot } from "@/components/ViewSlot";

// A view with no full-screen page of its own (no manifest fullPath) opened
// on its own - the same card as in the feed, given the whole screen.
export function ViewPage() {
  useAppliedTheme();
  const { chamber = "", viewId = "" } = useParams();
  const { data: registry, isLoading } = useQuery({ queryKey: ["congress", "registry"], queryFn: fetchRegistry });
  const entry = registry?.find((c) => c.name === chamber);
  const view = entry?.views?.find((v) => v.id === viewId);
  const back = useBackNavigation();

  return (
    <div className="chamber-shell">
      <ChamberHeader icon={<ChamberMark name={chamber} className="h-6 w-6 text-ink" />} title={entry?.displayName ?? chamber} titleHref="" onBack={back} />
      <main className="chamber-main">
        {isLoading && <p className="font-mono text-sm text-dust">Loading —</p>}
        {!isLoading && (!entry || !view) && <p className="font-mono text-sm text-dust">— This view isn't available —</p>}
        {entry && view && <ViewSlot chamber={entry} view={view} full />}
      </main>
    </div>
  );
}
