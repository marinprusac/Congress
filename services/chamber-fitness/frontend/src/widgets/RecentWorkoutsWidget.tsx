import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { WidgetPreviewShell, useShellHosted, resolveChamberPath } from "@congress/congress-ui";
import { fetchRecentWorkouts } from "@/lib/api";

export function RecentWorkoutsWidget() {
  const shellHosted = useShellHosted();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["workouts", "recent"],
    queryFn: fetchRecentWorkouts,
  });

  return (
    <WidgetPreviewShell
      label="Recent Workouts"
      // No "new workout" flow in this Chamber (Hevy is the sole source of
      // truth) - repurposes the shell's "+ New" slot to link to the full
      // list instead.
      addHref="/"
      addLabel="View all"
      ownChamber="fitness"
      isLoading={isLoading}
      isError={isError}
      errorLabel="Fitness unavailable."
      isEmpty={(data?.length ?? 0) === 0}
      emptyLabel="— No workouts synced yet —"
    >
      {data?.map((workout) => (
        <Link
          key={workout.id}
          to={resolveChamberPath(`/workouts/${workout.id}`, "fitness", shellHosted)}
          className="block truncate border-b border-dust py-1.5 font-display text-sm text-ink first:pt-0 last:border-b-0 hover:text-accent"
        >
          {workout.exhibitTitle}
        </Link>
      ))}
    </WidgetPreviewShell>
  );
}
