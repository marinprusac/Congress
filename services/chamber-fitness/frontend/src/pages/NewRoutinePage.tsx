import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useShellHosted, resolveChamberPath, useAutosave, FormErrorMessage } from "@congress/congress-ui";
import { createRoutine, fetchRoutineFolders } from "@/lib/api";
import { RoutineExercisesEditor, type DraftExercise, toRoutineExerciseInput } from "@/components/RoutineExercisesEditor";

// Folder is only ever set here, at create time - Hevy's PUT /routines/{id}
// body has no folder_id field at all, so a routine can never be moved
// between folders afterward. RoutineViewPage shows it read-only, if at all.
export function NewRoutinePage() {
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [folderId, setFolderId] = useState<number | null>(null);
  const [exercises, setExercises] = useState<DraftExercise[]>([]);

  const foldersQuery = useQuery({ queryKey: ["routine-folders"], queryFn: fetchRoutineFolders });

  const mutation = useMutation({
    mutationFn: () => createRoutine({ title, folderId, exercises: exercises.map(toRoutineExerciseInput) }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["routines"] });
      navigate(resolveChamberPath(`/routines/${created.id}`, "fitness", shellHosted));
    },
  });

  // No explicit Create button, matching every other Chamber's create flow -
  // but unlike a task/note, Hevy has no delete endpoint for a routine, so a
  // stray duplicate create can never be cleaned up via this app. Requiring
  // a title *and* at least one exercise with at least one set (which is
  // always true here, since RoutineExercisesEditor never creates an
  // exercise with zero sets) narrows the window for an accidental double
  // fire without fully eliminating it.
  useAutosave({
    value: { title, folderId, exercises },
    enabled: title.trim().length > 0 && exercises.length > 0 && !mutation.isPending && !mutation.isSuccess,
    onSave: () => mutation.mutate(),
  });

  return (
    <article>
      <div className="mb-6 border-b border-dust pb-4">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Routine name"
          className="w-full font-display text-3xl text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />
      </div>

      {mutation.isError && <FormErrorMessage>{(mutation.error as Error).message}</FormErrorMessage>}

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

      <RoutineExercisesEditor exercises={exercises} onLeafChange={setExercises} onStructuralChange={setExercises} />
    </article>
  );
}
