import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAutosave } from "@congress/congress-ui";
import { fetchRoutine, updateRoutine } from "@/lib/api";
import { RoutineExercisesEditor, type DraftExercise, toRoutineExerciseInput } from "@/components/RoutineExercisesEditor";

export function RoutineViewPage() {
  const { id } = useParams<{ id: string }>();
  const routineId = id ?? "";
  const queryClient = useQueryClient();

  const [draftTitle, setDraftTitle] = useState("");
  const [draftExercises, setDraftExercises] = useState<DraftExercise[]>([]);
  // Loads the draft exactly once per routine, not on every background
  // refetch - otherwise a resync would stomp an in-progress edit. Same
  // pattern as chamber-tasks' TaskViewPage.
  const initializedIdRef = useRef<string | null>(null);

  const routineQuery = useQuery({
    queryKey: ["routine", routineId],
    queryFn: () => fetchRoutine(routineId),
    enabled: routineId.length > 0,
  });

  const updateMutation = useMutation({
    mutationFn: (input: { title: string; exercises: DraftExercise[] }) =>
      updateRoutine(routineId, { title: input.title, exercises: input.exercises.map(toRoutineExerciseInput) }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["routine", routineId], updated);
      queryClient.invalidateQueries({ queryKey: ["routines"] });
    },
  });

  // One autosave over the whole draft tree, not one per field - Hevy's PUT
  // is a full replace, so there's no benefit to more than one save path.
  // This debounce covers every leaf-field edit (a set's weight/reps/rep
  // range, an exercise's rest seconds, the title). Structural edits
  // (add/remove/reorder) bypass it entirely via commitStructuralChange
  // below, which saves immediately and calls markSaved so this debounce's
  // own pending timer (if one was already running) finds nothing left to
  // persist and doesn't also fire.
  const { markSaved } = useAutosave({
    value: { title: draftTitle, exercises: draftExercises },
    enabled: initializedIdRef.current === routineId,
    onSave: (draft) => updateMutation.mutate(draft),
  });

  useEffect(() => {
    if (routineQuery.data && initializedIdRef.current !== routineQuery.data.id) {
      const draft = {
        title: routineQuery.data.title,
        exercises: routineQuery.data.exercises.map((exercise): DraftExercise => ({
          exerciseTemplateId: exercise.exerciseTemplateId,
          name: exercise.name,
          supersetId: exercise.supersetId,
          restSeconds: exercise.restSeconds,
          sets: exercise.sets.map((set) => ({
            type: set.type,
            weightKg: set.weightKg,
            reps: set.reps,
            repRangeStart: set.repRangeStart,
            repRangeEnd: set.repRangeEnd,
            durationSeconds: set.durationSeconds,
            distanceMeters: set.distanceMeters,
          })),
        })),
      };
      setDraftTitle(draft.title);
      setDraftExercises(draft.exercises);
      markSaved(draft);
      initializedIdRef.current = routineQuery.data.id;
    }
  }, [routineQuery.data, markSaved]);

  function commitStructuralChange(nextExercises: DraftExercise[]) {
    setDraftExercises(nextExercises);
    const nextDraft = { title: draftTitle, exercises: nextExercises };
    markSaved(nextDraft);
    updateMutation.mutate(nextDraft);
  }

  if (!routineId) return <p className="font-mono text-sm text-alert">Invalid routine id.</p>;
  if (routineQuery.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (routineQuery.isError || !routineQuery.data) return <p className="font-mono text-sm text-alert">Routine not found.</p>;

  const routine = routineQuery.data;

  return (
    <article>
      <div className="mb-6 border-b border-dust pb-4">
        <input
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          placeholder="Untitled"
          className="w-full font-display text-3xl text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />
        {/* Read-only: Hevy's PUT /routines/{id} body has no folder_id field
            at all, so a routine can never be moved between folders after
            creation - only NewRoutinePage has a folder picker. */}
        {routine.folderId != null && <p className="mt-1 font-mono text-xs text-dust">In a folder · not editable here</p>}
      </div>

      {updateMutation.isError && <p className="mb-4 font-mono text-sm text-alert">{(updateMutation.error as Error).message}</p>}

      <RoutineExercisesEditor exercises={draftExercises} onLeafChange={setDraftExercises} onStructuralChange={commitStructuralChange} />
    </article>
  );
}
