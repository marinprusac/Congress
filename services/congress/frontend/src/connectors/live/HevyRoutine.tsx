import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { showToast } from "@congress/congress-ui";
import { fetchLive } from "@/lib/recordsApi";
import { saveRoutineExercises, type RoutineExercise } from "@/lib/fitnessApi";
import { RoutineExercisesEditor, toRoutineExerciseInput, type DraftExercise } from "./RoutineExercisesEditor";
import type { LiveProps } from "./index";

const LEAF_DEBOUNCE_MS = 1000;

const toDraft = (e: RoutineExercise): DraftExercise => ({
  exerciseTemplateId: e.exerciseTemplateId,
  name: e.name,
  supersetId: e.supersetId,
  restSeconds: e.restSeconds,
  sets: e.sets.map(({ type, weightKg, reps, repRangeStart, repRangeEnd, durationSeconds, distanceMeters }) => ({
    type,
    weightKg,
    reps,
    repRangeStart,
    repRangeEnd,
    durationSeconds,
    distanceMeters,
  })),
});

// A routine's exercises, edited here and saved to Hevy: adding, removing or
// moving saves at once, typing a number after a pause.
export function HevyRoutine({ recordId, sourceKey }: LiveProps) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["record", recordId, "live"], queryFn: () => fetchLive<{ exercises: RoutineExercise[] }>(recordId) });
  const [draft, setDraft] = useState<DraftExercise[] | null>(null);
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (q.data && draft === null) setDraft(q.data.exercises.map(toDraft));
  }, [q.data, draft]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const save = async (next: DraftExercise[]) => {
    clearTimeout(timer.current);
    setSaving(true);
    try {
      await saveRoutineExercises(sourceKey, next.map(toRoutineExerciseInput));
      void queryClient.invalidateQueries({ queryKey: ["record", recordId] });
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't save to Hevy.", "error");
    } finally {
      setSaving(false);
    }
  };

  if (q.isLoading || draft === null) return q.isError ? <p className="font-mono text-sm text-alert">Couldn't load the routine.</p> : <p className="font-mono text-sm text-dust">Loading —</p>;
  return (
    <div className="min-w-0">
      <RoutineExercisesEditor
        exercises={draft}
        onLeafChange={(next) => {
          setDraft(next);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => void save(next), LEAF_DEBOUNCE_MS);
        }}
        onStructuralChange={(next) => {
          setDraft(next);
          void save(next);
        }}
      />
      <p className="mt-3 font-mono text-xs text-dust">{saving ? "Saving to Hevy —" : "Changes save to Hevy."}</p>
    </div>
  );
}
