import { useQuery } from "@tanstack/react-query";
import { WidgetPreviewShell } from "@congress/congress-ui";
import { fetchWeekStats } from "@/lib/api";

export function WeekStatsWidget() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["workouts", "week-stats"],
    queryFn: fetchWeekStats,
  });

  return (
    <WidgetPreviewShell
      label="This Week"
      addHref="/"
      addLabel="View all"
      ownChamber="fitness"
      isLoading={isLoading}
      isError={isError}
      errorLabel="Fitness unavailable."
      isEmpty={!isLoading && !isError && (data?.workoutCount ?? 0) === 0}
      emptyLabel="— No workouts this week —"
    >
      {data && (
        <div className="flex h-full flex-col justify-center gap-1">
          <p className="font-display text-3xl text-ink">
            {data.workoutCount} workout{data.workoutCount === 1 ? "" : "s"}
          </p>
          <p className="font-mono text-xs text-dust">{Math.round(data.totalVolumeKg).toLocaleString()} kg total volume</p>
        </div>
      )}
    </WidgetPreviewShell>
  );
}
