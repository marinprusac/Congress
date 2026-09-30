import { z } from "zod";

// Hevy's shapes as this connector keeps and serves them (ported from the Fitness Chamber).

export const persistedWorkoutSetSchema = z.object({
  index: z.number().int(),
  weightKg: z.number().nullable(),
  reps: z.number().int().nullable(),
  durationSeconds: z.number().nullable(),
  distanceMeters: z.number().nullable(),
  rpe: z.number().nullable(),
});
export type PersistedWorkoutSet = z.infer<typeof persistedWorkoutSetSchema>;

export const persistedWorkoutExerciseSchema = z.object({
  name: z.string(),
  sets: z.array(persistedWorkoutSetSchema),
});
export type PersistedWorkoutExercise = z.infer<typeof persistedWorkoutExerciseSchema>;

export const routineSetSchema = z.object({
  index: z.number().int(),
  type: z.enum(["normal", "warmup", "dropset", "failure"]),
  weightKg: z.number().nullable(),
  reps: z.number().int().nullable(),
  repRangeStart: z.number().int().nullable(),
  repRangeEnd: z.number().int().nullable(),
  durationSeconds: z.number().nullable(),
  distanceMeters: z.number().nullable(),
  rpe: z.number().nullable(),
});
export type RoutineSet = z.infer<typeof routineSetSchema>;

export const routineExerciseSchema = z.object({
  exerciseTemplateId: z.string(),
  name: z.string(),
  supersetId: z.number().int().nullable(),
  restSeconds: z.number().int().nullable(),
  sets: z.array(routineSetSchema),
});
export type RoutineExercise = z.infer<typeof routineExerciseSchema>;

export interface RoutineDetail {
  id: string;
  title: string;
  folderId: number | null;
  updatedAt: string;
  createdAt: string;
  exercises: RoutineExercise[];
}

export interface RoutineFolder {
  id: number;
  index: number;
  title: string;
}

export interface ExerciseTemplate {
  id: string;
  title: string;
  primaryMuscleGroup: string | null;
}

export const routineSetInputSchema = z.object({
  type: z.enum(["normal", "warmup", "dropset", "failure"]),
  weightKg: z.number().nullable(),
  reps: z.number().int().nullable(),
  repRangeStart: z.number().int().nullable(),
  repRangeEnd: z.number().int().nullable(),
  durationSeconds: z.number().nullable(),
  distanceMeters: z.number().nullable(),
});
export type RoutineSetInput = z.infer<typeof routineSetInputSchema>;

export const routineExerciseInputSchema = z.object({
  exerciseTemplateId: z.string().min(1),
  supersetId: z.number().int().nullable(),
  restSeconds: z.number().int().nullable(),
  sets: z.array(routineSetInputSchema),
});
export type RoutineExerciseInput = z.infer<typeof routineExerciseInputSchema>;

export const createRoutineInputSchema = z.object({
  title: z.string().trim().min(1),
  folderId: z.number().int().nullable(),
  exercises: z.array(routineExerciseInputSchema).min(1),
});
export type CreateRoutineInput = z.infer<typeof createRoutineInputSchema>;
