import { useState } from "react";
import {
  useShellHosted,
  resolveChamberPath,
  useSearchableList,
  useListRowPrefetch,
  ListSearchInput,
  ListErrorState,
  ListEmptyState,
  CompactCard,
  CardFlow,
  CardFlowLoadingState,
} from "@congress/congress-ui";
import { fetchWorkouts, fetchWorkout } from "@/lib/api";

export function WorkoutsListPage() {
  const [query, setQuery] = useState("");
  const shellHosted = useShellHosted();

  const { data, isLoading, isError } = useSearchableList({
    queryKeyBase: "workouts",
    query,
    fetchAll: fetchWorkouts,
    filterClient: (workout, q) => workout.exhibitTitle.toLowerCase().includes(q),
  });

  const prefetchWorkout = useListRowPrefetch((id: number) => ["workout", id], fetchWorkout);

  return (
    <section className="list-page">
      {/* No newHref: workouts are read-only here, imported from Hevy - there's
          no "new workout" flow in this Chamber. */}
      <ListSearchInput value={query} onChange={setQuery} placeholder="Search workouts —" />

      <div className="mt-4">
        {isLoading && <CardFlowLoadingState />}
        {isError && <ListErrorState label="Workouts" />}
        {!isLoading && !isError && data?.length === 0 && <ListEmptyState label="workouts" hasQuery={!!query} />}
        {!isLoading && !isError && data && data.length > 0 && (
          <CardFlow>
            {data.map((workout) => (
              <CompactCard
                key={workout.id}
                href={resolveChamberPath(`/workouts/${workout.id}`, "fitness", shellHosted)}
                onMouseEnter={() => prefetchWorkout(workout.id)}
                onFocus={() => prefetchWorkout(workout.id)}
                title={workout.exhibitTitle}
                subtitle={
                  <>
                    {workout.exerciseCount} exercise{workout.exerciseCount === 1 ? "" : "s"}
                    {workout.totalVolumeKg != null && ` · ${Math.round(workout.totalVolumeKg).toLocaleString()} kg`}
                  </>
                }
              />
            ))}
          </CardFlow>
        )}
      </div>
    </section>
  );
}
