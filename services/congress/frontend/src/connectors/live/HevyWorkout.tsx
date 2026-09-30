import { useQuery } from "@tanstack/react-query";
import { fetchLive } from "@/lib/recordsApi";
import type { LiveProps } from "./index";
import { formatSet, type WorkoutSet } from "@/views/health/format";

// A workout's sets from the hevy connector (src/connectors/hevy/cache.ts workoutDetail).
interface WorkoutDetail {
  exercises: { name: string; sets: WorkoutSet[] }[];
}

export function HevyWorkout({ recordId }: LiveProps) {
  const q = useQuery({ queryKey: ["record", recordId, "live"], queryFn: () => fetchLive<WorkoutDetail>(recordId) });
  if (q.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (q.isError || !q.data) return <p className="font-mono text-sm text-alert">Couldn't load the sets.</p>;
  if (q.data.exercises.length === 0) return <p className="font-mono text-sm text-dust">— No exercises recorded —</p>;
  return (
    <div className="min-w-0 space-y-6">
      {q.data.exercises.map((exercise, i) => (
        <div key={i}>
          <h3 className="mb-1 font-display text-lg text-ink">{exercise.name}</h3>
          {exercise.sets.map((set, j) => (
            <div key={j} className="flex items-baseline gap-2 border-t border-dust/50 py-1.5 font-mono text-sm text-ink">
              <span className="w-4 shrink-0 text-dust">{j + 1}</span>
              <span className="flex-1">{formatSet(set)}</span>
              <span className="shrink-0 text-xs text-dust">{set.oneRepMax != null ? `1RM ${set.oneRepMax.toFixed(1)} kg` : "—"}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
