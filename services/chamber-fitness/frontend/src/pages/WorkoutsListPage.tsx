import { Link } from "react-router-dom";
import { useState } from "react";
import {
  useShellHosted,
  resolveChamberPath,
  useSearchableList,
  useListRowPrefetch,
  ListSearchInput,
  ListLoadingState,
  ListErrorState,
  ListEmptyState,
} from "@congress/congress-ui";
import { fetchWorkouts, fetchWorkout } from "@/lib/api";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function WorkoutsListPage() {
  const [query, setQuery] = useState("");
  const shellHosted = useShellHosted();

  const { data, isLoading, isError } = useSearchableList({
    queryKeyBase: "workouts",
    query,
    fetchAll: fetchWorkouts,
    filterClient: (workout, q) => workout.title.toLowerCase().includes(q),
  });

  const prefetchWorkout = useListRowPrefetch((id: number) => ["workout", id], fetchWorkout);

  return (
    <section className="list-page">
      {/* No newHref: workouts are read-only here, imported from Hevy - there's
          no "new workout" flow in this Chamber. */}
      <ListSearchInput value={query} onChange={setQuery} placeholder="Search workouts —" />

      <div className="border-t border-dust">
        {isLoading && <ListLoadingState />}
        {isError && <ListErrorState label="Workouts" />}
        {!isLoading && !isError && data?.length === 0 && <ListEmptyState label="workouts" hasQuery={!!query} />}
        {!isLoading &&
          !isError &&
          data?.map((workout) => (
            <Link
              key={workout.id}
              to={resolveChamberPath(`/workouts/${workout.id}`, "fitness", shellHosted)}
              onMouseEnter={() => prefetchWorkout(workout.id)}
              onFocus={() => prefetchWorkout(workout.id)}
              className="block border-b border-dust px-1 py-3 hover:bg-ink/[0.03]"
            >
              <span className="font-display text-lg text-ink">{workout.title}</span>
              <p className="mt-1 text-sm text-slate">
                {formatDate(workout.startTime)} · {workout.exerciseCount} exercise{workout.exerciseCount === 1 ? "" : "s"}
                {workout.totalVolumeKg != null && ` · ${Math.round(workout.totalVolumeKg).toLocaleString()} kg`}
              </p>
            </Link>
          ))}
      </div>
    </section>
  );
}
