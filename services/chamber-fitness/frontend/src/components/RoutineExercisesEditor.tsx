import type { ExerciseTemplate, RoutineExerciseInput, RoutineSetInput } from "../../../src/types";
import { ExerciseTemplatePicker } from "./ExerciseTemplatePicker";

export interface DraftSet extends RoutineSetInput {}

export interface DraftExercise extends Omit<RoutineExerciseInput, "sets"> {
  // Display-only - Hevy echoes this back on an existing routine's exercises,
  // and a freshly-picked template supplies it here too. Never sent back on
  // save (toRoutineExerciseInput below drops it).
  name: string;
  sets: DraftSet[];
}

function emptySet(): DraftSet {
  return { type: "normal", weightKg: null, reps: null, repRangeStart: null, repRangeEnd: null, durationSeconds: null, distanceMeters: null };
}

export function newDraftExercise(template: ExerciseTemplate): DraftExercise {
  return { exerciseTemplateId: template.id, name: template.title, supersetId: null, restSeconds: null, sets: [emptySet()] };
}

export function toRoutineExerciseInput({ name: _name, ...rest }: DraftExercise): RoutineExerciseInput {
  return rest;
}

const SET_TYPE_OPTIONS: DraftSet["type"][] = ["normal", "warmup", "dropset", "failure"];

function numberOrNull(raw: string): number | null {
  return raw === "" ? null : Number(raw);
}

export interface RoutineExercisesEditorProps {
  exercises: DraftExercise[];
  // Weight/reps/rest field edits - autosaved on the caller's own debounce.
  onLeafChange: (next: DraftExercise[]) => void;
  // Add/remove/reorder an exercise or set - the caller saves this
  // immediately, bypassing the debounce (see RoutineViewPage/NewRoutinePage).
  onStructuralChange: (next: DraftExercise[]) => void;
}

// Reordering uses up/down buttons rather than drag-and-drop: this app's
// existing drag tool (useReorderableList) isn't built for a two-level
// nested list (exercises containing sets), and reworking it for that shape
// was scoped out in favor of this simpler, lower-risk control.
export function RoutineExercisesEditor({ exercises, onLeafChange, onStructuralChange }: RoutineExercisesEditorProps) {
  function updateExercise(index: number, patch: Partial<DraftExercise>) {
    onLeafChange(exercises.map((ex, i) => (i === index ? { ...ex, ...patch } : ex)));
  }

  function updateSet(exerciseIndex: number, setIndex: number, patch: Partial<DraftSet>) {
    onLeafChange(
      exercises.map((ex, i) => (i === exerciseIndex ? { ...ex, sets: ex.sets.map((s, j) => (j === setIndex ? { ...s, ...patch } : s)) } : ex))
    );
  }

  function addSet(exerciseIndex: number) {
    onStructuralChange(exercises.map((ex, i) => (i === exerciseIndex ? { ...ex, sets: [...ex.sets, emptySet()] } : ex)));
  }

  function removeSet(exerciseIndex: number, setIndex: number) {
    onStructuralChange(exercises.map((ex, i) => (i === exerciseIndex ? { ...ex, sets: ex.sets.filter((_, j) => j !== setIndex) } : ex)));
  }

  function moveSet(exerciseIndex: number, setIndex: number, direction: -1 | 1) {
    const exercise = exercises[exerciseIndex];
    const target = setIndex + direction;
    if (!exercise || target < 0 || target >= exercise.sets.length) return;
    const sets = [...exercise.sets];
    [sets[setIndex], sets[target]] = [sets[target]!, sets[setIndex]!];
    onStructuralChange(exercises.map((ex, i) => (i === exerciseIndex ? { ...ex, sets } : ex)));
  }

  function removeExercise(index: number) {
    onStructuralChange(exercises.filter((_, i) => i !== index));
  }

  function moveExercise(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= exercises.length) return;
    const next = [...exercises];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onStructuralChange(next);
  }

  function addExercise(template: ExerciseTemplate) {
    onStructuralChange([...exercises, newDraftExercise(template)]);
  }

  return (
    <div className="space-y-6">
      {exercises.length === 0 && <p className="font-mono text-sm text-dust">— No exercises yet —</p>}
      {exercises.map((exercise, exerciseIndex) => (
        <div key={exerciseIndex} className="border border-dust p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="font-display text-lg text-ink">{exercise.name}</h3>
            <div className="flex items-center gap-2 font-mono text-xs">
              <button type="button" onClick={() => moveExercise(exerciseIndex, -1)} disabled={exerciseIndex === 0} className="tap-target px-1 text-dust disabled:opacity-30">
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveExercise(exerciseIndex, 1)}
                disabled={exerciseIndex === exercises.length - 1}
                className="tap-target px-1 text-dust disabled:opacity-30"
              >
                ↓
              </button>
              <button type="button" onClick={() => removeExercise(exerciseIndex)} className="tap-target px-1 text-alert">
                Remove
              </button>
            </div>
          </div>

          <div className="mb-2 flex items-center gap-2 font-mono text-xs text-dust">
            <label htmlFor={`rest-${exerciseIndex}`}>Rest (s)</label>
            <input
              id={`rest-${exerciseIndex}`}
              type="number"
              value={exercise.restSeconds ?? ""}
              onChange={(e) => updateExercise(exerciseIndex, { restSeconds: numberOrNull(e.target.value) })}
              className="w-16 border border-dust bg-parchment px-1 py-0.5 font-mono text-sm text-ink"
            />
          </div>

          <div className="space-y-1.5">
            {exercise.sets.map((set, setIndex) => (
              <div key={setIndex} className="flex flex-wrap items-center gap-1.5 font-mono text-sm">
                <span className="w-4 text-dust">{setIndex + 1}</span>
                <select
                  value={set.type}
                  onChange={(e) => updateSet(exerciseIndex, setIndex, { type: e.target.value as DraftSet["type"] })}
                  className="border border-dust bg-parchment px-1 py-1 text-xs text-ink"
                >
                  {SET_TYPE_OPTIONS.map((type) => (
                    <option key={type} value={type}>
                      {type[0]!.toUpperCase() + type.slice(1)}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  placeholder="kg"
                  value={set.weightKg ?? ""}
                  onChange={(e) => updateSet(exerciseIndex, setIndex, { weightKg: numberOrNull(e.target.value) })}
                  className="w-16 border border-dust bg-parchment px-1 py-1 text-ink placeholder:text-dust"
                />
                <input
                  type="number"
                  placeholder="reps"
                  value={set.reps ?? ""}
                  onChange={(e) => updateSet(exerciseIndex, setIndex, { reps: numberOrNull(e.target.value) })}
                  className="w-16 border border-dust bg-parchment px-1 py-1 text-ink placeholder:text-dust"
                />
                <input
                  type="number"
                  placeholder="min"
                  title="Rep range start"
                  value={set.repRangeStart ?? ""}
                  onChange={(e) => updateSet(exerciseIndex, setIndex, { repRangeStart: numberOrNull(e.target.value) })}
                  className="w-14 border border-dust bg-parchment px-1 py-1 text-ink placeholder:text-dust"
                />
                <span className="text-dust">–</span>
                <input
                  type="number"
                  placeholder="max"
                  title="Rep range end"
                  value={set.repRangeEnd ?? ""}
                  onChange={(e) => updateSet(exerciseIndex, setIndex, { repRangeEnd: numberOrNull(e.target.value) })}
                  className="w-14 border border-dust bg-parchment px-1 py-1 text-ink placeholder:text-dust"
                />
                <button
                  type="button"
                  onClick={() => moveSet(exerciseIndex, setIndex, -1)}
                  disabled={setIndex === 0}
                  className="tap-target px-1 text-dust disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveSet(exerciseIndex, setIndex, 1)}
                  disabled={setIndex === exercise.sets.length - 1}
                  className="tap-target px-1 text-dust disabled:opacity-30"
                >
                  ↓
                </button>
                <button type="button" onClick={() => removeSet(exerciseIndex, setIndex)} className="tap-target px-1 text-alert">
                  ×
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => addSet(exerciseIndex)} className="mt-2 font-mono text-xs text-accent hover:underline">
            + Add set
          </button>
        </div>
      ))}
      <ExerciseTemplatePicker onSelect={addExercise} />
    </div>
  );
}
