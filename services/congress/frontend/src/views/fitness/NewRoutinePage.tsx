import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChamberHeader, ChamberMark, showToast, useAppliedTheme, useBackNavigation, useDraftCreate, useStackNav } from "@congress/congress-ui";
import { createRoutine, fetchRoutineFolders } from "@/lib/fitnessApi";
import { RoutineExercisesEditor, toRoutineExerciseInput, type DraftExercise } from "@/connectors/live/RoutineExercisesEditor";

// A new Hevy routine. It goes to Hevy once it has a title and an exercise,
// exactly once (Hevy can't delete a routine), then opens as a Routine record.
// The folder can only be chosen here: Hevy can't move a routine later.
export function NewRoutinePage() {
  useAppliedTheme();
  const back = useBackNavigation();
  const nav = useStackNav();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [folderId, setFolderId] = useState<number | null>(null);
  const [exercises, setExercises] = useState<DraftExercise[]>([]);
  const created = useRef(false);
  const folders = useQuery({ queryKey: ["hevy", "folders"], queryFn: fetchRoutineFolders });

  const create = useMutation({
    mutationFn: (draft: { title: string; folderId: number | null; exercises: DraftExercise[] }) =>
      createRoutine({ title: draft.title.trim(), folderId: draft.folderId, exercises: draft.exercises.map(toRoutineExerciseInput) }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ["records"] });
      if (res.recordId) navigate(`/e/${res.recordId}`, { replace: true });
      else nav.pop();
    },
    // Never retried on its own: an unclear failure could still have created it.
    onError: (err) => showToast(err instanceof Error ? err.message : "Couldn't create it in Hevy.", "error"),
  });

  const draftCreate = useDraftCreate({
    value: { title, folderId, exercises },
    canCreate: (v) => !created.current && v.title.trim().length > 0 && v.exercises.length > 0,
    onCreate: (draft) => {
      created.current = true;
      create.mutate(draft);
    },
  });

  // Adding the first exercise is usually what completes it.
  useEffect(() => {
    draftCreate.attempt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercises.length]);

  return (
    <div className="chamber-shell">
      <ChamberHeader icon={<ChamberMark name="fitness" className="h-6 w-6 text-ink" />} title="New routine" titleHref="" onBack={back} />
      <main className="chamber-main">
        <div className="mb-6 border-b border-dust pb-4">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => draftCreate.attempt()}
            placeholder="Routine name"
            className="w-full font-display text-3xl text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          />
        </div>
        {(folders.data?.length ?? 0) > 0 && (
          <label className="mb-6 flex items-center gap-2 font-mono text-sm text-slate">
            Folder
            <select className="field-plain font-mono text-sm" value={folderId ?? ""} onChange={(e) => setFolderId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">None</option>
              {folders.data!.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <RoutineExercisesEditor exercises={exercises} onLeafChange={setExercises} onStructuralChange={setExercises} />
        <p className="mt-4 font-mono text-xs text-dust">{create.isPending ? "Creating in Hevy —" : "It's created in Hevy once it has a name and an exercise."}</p>
      </main>
    </div>
  );
}
