import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ExhibitLinksLayout, navigateToExhibit, getChamberIcon, useShellHosted } from "@congress/congress-ui";
import { fetchWorkout } from "@/lib/api";

function formatDuration(startIso: string, endIso: string): string {
  const minutes = Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000));
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

export function WorkoutViewPage() {
  const { id } = useParams<{ id: string }>();
  const workoutId = Number(id);
  const navigate = useNavigate();
  const shellHosted = useShellHosted();

  const workoutQuery = useQuery({
    queryKey: ["workout", workoutId],
    queryFn: () => fetchWorkout(workoutId),
    enabled: Number.isInteger(workoutId),
  });

  if (!Number.isInteger(workoutId)) return <p className="font-mono text-sm text-alert">Invalid workout id.</p>;
  if (workoutQuery.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (workoutQuery.isError || !workoutQuery.data) return <p className="font-mono text-sm text-alert">Workout not found.</p>;

  const workout = workoutQuery.data;

  return (
    <article>
      <div className="mb-6 border-b border-dust pb-4">
        <h2 className="font-display text-3xl text-ink">{workout.exhibitTitle}</h2>
        <p className="mt-1 font-mono text-sm text-dust">
          {new Date(workout.startTime).toLocaleString()} · {formatDuration(workout.startTime, workout.endTime)}
          {workout.totalVolumeKg != null && ` · ${Math.round(workout.totalVolumeKg).toLocaleString()} kg volume`}
        </p>
      </div>

      {/* No onCreateReference: workouts aren't a Chamber whose Exhibits can
          be quick-created from a picker (they only ever come from Hevy),
          same restraint as chamber-calendar's own event view. */}
      <ExhibitLinksLayout
        exhibitId={`workout-${workoutId}`}
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("fitness", r, navigate, shellHosted)}
        editable
      >
        <div className="space-y-6">
          {workout.exercises.length === 0 && <p className="font-mono text-sm text-dust">— No exercises recorded —</p>}
          {workout.exercises.map((exercise, exerciseIndex) => (
            <div key={exerciseIndex}>
              <h3 className="mb-2 font-display text-lg text-ink">{exercise.name}</h3>
              <table className="w-full font-mono text-sm text-ink">
                <thead>
                  <tr className="text-left text-dust">
                    <th className="pb-1 pr-2 font-normal">#</th>
                    <th className="pb-1 pr-2 font-normal">Type</th>
                    <th className="pb-1 pr-2 font-normal">Weight</th>
                    <th className="pb-1 pr-2 font-normal">Reps</th>
                    <th className="pb-1 font-normal">RPE</th>
                  </tr>
                </thead>
                <tbody>
                  {exercise.sets.map((set, setIndex) => (
                    <tr key={setIndex} className="border-t border-dust/50">
                      <td className="py-1 pr-2">{set.index + 1}</td>
                      <td className="py-1 pr-2 capitalize">{set.type}</td>
                      <td className="py-1 pr-2">{set.weightKg != null ? `${set.weightKg} kg` : "—"}</td>
                      <td className="py-1 pr-2">{set.reps ?? "—"}</td>
                      <td className="py-1">{set.rpe ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </ExhibitLinksLayout>
    </article>
  );
}
