import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useShellHosted, resolveChamberPath, useAutosave, useDraftCreate, resolveEditorIdentity, FormErrorMessage } from "@congress/congress-ui";
import { createRoutine, fetchRoutine, updateRoutine, fetchRoutineFolders } from "@/lib/api";
import { RoutineExercisesEditor, type DraftExercise, toRoutineExerciseInput } from "@/components/RoutineExercisesEditor";

// Handles both "create" (route `/routines/new`, no `:id`) and "edit" (route
// `/routines/:id`) as one mounted component - see chamber-notes'
// NoteEditorPage, which this mirrors, for the full reasoning behind
// merging the two. Extra caution here versus every other chamber's
// equivalent: Hevy has no delete endpoint for a routine, so a stray
// duplicate create can never be cleaned up via this app - useDraftCreate's
// once-only guard matters more here than anywhere else.
//
// `id` is Hevy's own routine id (an opaque string, not a local
// auto-increment), and folder is create-only - Hevy's PUT /routines/{id}
// body has no folder_id field at all, so a routine can never be moved
// between folders afterward. The folder picker is therefore only ever
// shown while still a draft.
export function RoutineEditorPage() {
  const { id: idParam } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();

  const [routineId, setRoutineId] = useState<string | null>(idParam ?? null);
  const [draftTitle, setDraftTitle] = useState("");
  const [folderId, setFolderId] = useState<number | null>(null);
  const [draftExercises, setDraftExercises] = useState<DraftExercise[]>([]);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  const foldersQuery = useQuery({ queryKey: ["routine-folders"], queryFn: fetchRoutineFolders });

  const routineQuery = useQuery({
    queryKey: ["routine", routineId],
    queryFn: () => fetchRoutine(routineId as string),
    enabled: routineId !== null,
  });

  const createMutation = useMutation({
    // Reads `folderId` off `draft` (the value useDraftCreate/
    // draftCreate.attempt() actually captured), not the `folderId` state
    // variable directly - the identity-reset effect that can trigger this
    // clears it back to null on the very next line after calling attempt(),
    // so closing over it here would race.
    mutationFn: (draft: { title: string; folderId: number | null; exercises: DraftExercise[] }) =>
      createRoutine({ title: draft.title, folderId: draft.folderId, exercises: draft.exercises.map(toRoutineExerciseInput) }),
    onSuccess: (created, draft) => {
      queryClient.setQueryData(["routine", created.id], created);
      queryClient.invalidateQueries({ queryKey: ["routines"] });
      if (routineId !== null) return;
      initializedIdRef.current = created.id;
      // Matches the update-mode autosave's own `value` shape below (no
      // `folderId` - it's create-only) so this doesn't immediately read as
      // an unsaved change and fire a redundant update right after creation.
      markSaved({ title: draft.title, exercises: draft.exercises });
      setRoutineId(created.id);
      navigate(resolveChamberPath(`/routines/${created.id}`, "fitness", shellHosted), { replace: true });
    },
    onError: () => draftCreate.reset(),
  });

  // Fires on the title field's blur (see the input's onBlur below) and on
  // exercises changing (see the effect below) rather than a content-change
  // debounce - see useDraftCreate's own comment. Requiring a title *and* at
  // least one exercise with at least one set (always true here, since
  // RoutineExercisesEditor never creates an exercise with zero sets)
  // narrows the window for an accidental double fire without fully
  // eliminating it - the once-only guard is what actually prevents it.
  const draftCreate = useDraftCreate({
    value: { title: draftTitle, folderId, exercises: draftExercises },
    canCreate: (v) => routineId === null && v.title.trim().length > 0 && v.exercises.length > 0,
    onCreate: (draft) => createMutation.mutate(draft),
  });

  // Adding the first exercise (rather than a field within it changing) is
  // usually what completes the create gate, and RoutineExercisesEditor's
  // add/remove is a discrete structural action, not continuous typing -
  // this must be an effect rather than calling `attempt()` inline from
  // `onStructuralChange` below, since `attempt()` reads `draftExercises`
  // through a ref that only catches up on the *next* render.
  useEffect(() => {
    draftCreate.attempt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftExercises]);

  // A navigation between two different ids, or back to the draft/"new"
  // route, reuses this same mounted component - see resolveEditorIdentity's
  // own comment.
  useEffect(() => {
    const fromUrl = idParam ?? null;
    if (resolveEditorIdentity(fromUrl, routineId) === "keep") return;
    draftCreate.attempt();
    setRoutineId(fromUrl);
    setDraftTitle("");
    setFolderId(null);
    setDraftExercises([]);
    initializedIdRef.current = null;
    draftCreate.reset();
    if (fromUrl === null) titleInputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idParam, routineId]);

  const updateMutation = useMutation({
    mutationFn: (input: { title: string; exercises: DraftExercise[] }) =>
      updateRoutine(routineId as string, { title: input.title, exercises: input.exercises.map(toRoutineExerciseInput) }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["routine", routineId], updated);
      queryClient.invalidateQueries({ queryKey: ["routines"] });
    },
  });

  // One autosave over the whole draft tree, not one per field - Hevy's PUT
  // is a full replace, so there's no benefit to more than one save path.
  // Also covers the just-created routine: its query is pre-seeded via
  // setQueryData above, so this effect's `markSaved` runs immediately
  // without feeding a stale/empty server value back into the editor.
  const initializedIdRef = useRef<string | null>(null);
  const { markSaved } = useAutosave({
    value: { title: draftTitle, exercises: draftExercises },
    enabled: routineId !== null && initializedIdRef.current === routineId,
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

  // Structural edits (add/remove/reorder) bypass the debounce entirely,
  // saving immediately and calling markSaved so the debounce's own pending
  // timer (if one was already running) finds nothing left to persist and
  // doesn't also fire - only meaningful once persisted; while still a draft
  // there's nothing to save yet (the effect above handles firing the
  // create itself).
  function commitStructuralChange(nextExercises: DraftExercise[]) {
    setDraftExercises(nextExercises);
    if (routineId === null) return;
    const nextDraft = { title: draftTitle, exercises: nextExercises };
    markSaved(nextDraft);
    updateMutation.mutate(nextDraft);
  }

  const isDraft = routineId === null;
  if (!isDraft && routineQuery.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (!isDraft && (routineQuery.isError || !routineQuery.data))
    return <p className="font-mono text-sm text-alert">Routine not found.</p>;

  const routine = isDraft ? null : routineQuery.data ?? null;

  return (
    <article>
      <div className="mb-6 border-b border-dust pb-4">
        <input
          ref={titleInputRef}
          autoFocus={isDraft}
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          onBlur={() => draftCreate.attempt()}
          placeholder={isDraft ? "Routine name" : "Untitled"}
          className="w-full font-display text-3xl text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />
        {/* Read-only once persisted: Hevy's PUT /routines/{id} body has no
            folder_id field at all, so a routine can never be moved between
            folders after creation - only the draft form below has a
            picker. */}
        {!isDraft && routine?.folderId != null && (
          <p className="mt-1 font-mono text-xs text-dust">In a folder · not editable here</p>
        )}
      </div>

      {createMutation.isError && <FormErrorMessage>{(createMutation.error as Error).message}</FormErrorMessage>}
      {updateMutation.isError && (
        <p className="mb-4 font-mono text-sm text-alert">{(updateMutation.error as Error).message}</p>
      )}

      {isDraft && (
        <div className="mb-6">
          <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust" htmlFor="routine-folder">
            Folder (optional)
          </label>
          <select
            id="routine-folder"
            value={folderId ?? ""}
            onChange={(e) => setFolderId(e.target.value === "" ? null : Number(e.target.value))}
            className="border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink"
          >
            <option value="">No folder</option>
            {foldersQuery.data?.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.title}
              </option>
            ))}
          </select>
        </div>
      )}

      <RoutineExercisesEditor
        exercises={draftExercises}
        onLeafChange={setDraftExercises}
        onStructuralChange={commitStructuralChange}
      />
    </article>
  );
}
