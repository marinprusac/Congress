import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ExhibitLinksLayout, navigateToExhibit, getChamberIcon, useShellHosted } from "@congress/congress-ui";
import { fetchWorkout } from "@/lib/api";
import type { WorkoutSetView } from "../../../src/types";

function formatDuration(startIso: string, endIso: string): string {
  const minutes = Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000));
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

// A set carries whichever of weight/reps/duration/distance its exercise
// type uses (Hevy shares one set shape across weight-, duration-, and
// distance-based exercises) - this picks whichever the set actually has
// data for, so a cardio set still reads as something instead of a blank
// "— kg × —".
function formatSetPrimary(set: WorkoutSetView): string {
  if (set.weightKg != null && set.reps != null) return `${set.weightKg} kg × ${set.reps}`;
  if (set.weightKg != null) return `${set.weightKg} kg`;
  if (set.reps != null) return `${set.reps} reps`;
  if (set.durationSeconds != null) {
    const mins = Math.floor(set.durationSeconds / 60);
    const secs = Math.round(set.durationSeconds % 60);
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }
  if (set.distanceMeters != null) {
    return set.distanceMeters >= 1000 ? `${(set.distanceMeters / 1000).toFixed(2)} km` : `${set.distanceMeters} m`;
  }
  return "—";
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
              <h3 className="mb-1 font-display text-lg text-ink">{exercise.name}</h3>
              <div>
                {exercise.sets.map((set, setIndex) => (
                  <div
                    key={setIndex}
                    className="flex items-baseline gap-2 border-t border-dust/50 py-1.5 font-mono text-sm text-ink"
                  >
                    <span className="w-4 shrink-0 text-dust">{set.index + 1}</span>
                    <span className="flex-1">{formatSetPrimary(set)}</span>
                    <span className="shrink-0 text-xs text-dust">
                      {set.oneRepMax != null ? `1RM ${set.oneRepMax.toFixed(1)} kg` : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </ExhibitLinksLayout>
    </article>
  );
}
