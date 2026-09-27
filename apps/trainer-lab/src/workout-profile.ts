import type { Workout, WorkoutStep } from "./workout";

export interface WorkoutBlock {
  repeat: number;
  steps: WorkoutStep[];
}

export interface WorkoutProfile {
  id: string;
  name: string;
  blocks: WorkoutBlock[];
}

export const WORKOUT_LIMITS = { blocks: 100, steps: 500, repeats: 20, seconds: 86400 } as const;

export function workoutFromProfile(profile: WorkoutProfile): Workout {
  const valid = validateWorkoutProfile(profile);
  const steps = valid.blocks.flatMap((block) =>
    Array.from({ length: block.repeat }, () => block.steps.map((step) => ({ ...step }))).flat(),
  );
  return { name: valid.name, steps, seconds: steps.reduce((sum, step) => sum + step.seconds, 0) };
}

export function profileFromWorkout(workout: Workout, id = "draft"): WorkoutProfile {
  if (workout.seconds === null) throw new Error("Choose a timed workout to edit its blocks.");
  return validateWorkoutProfile({
    id,
    name: workout.name,
    blocks: [{ repeat: 1, steps: workout.steps.map((step) => ({ ...step })) }],
  });
}

export function validateWorkoutProfile(value: unknown): WorkoutProfile {
  if (!object(value) || !shortText(value.name) || !shortText(value.id))
    throw new Error("Give the workout a name of up to 100 characters.");
  if (
    !Array.isArray(value.blocks) ||
    !value.blocks.length ||
    value.blocks.length > WORKOUT_LIMITS.blocks
  )
    throw new Error(`A workout needs 1–${WORKOUT_LIMITS.blocks} blocks.`);
  const blocks = value.blocks.map(readBlock);
  const count = blocks.reduce((total, block) => total + block.steps.length * block.repeat, 0);
  const seconds = blocks.reduce(
    (total, block) =>
      total + block.steps.reduce((sum, step) => sum + step.seconds, 0) * block.repeat,
    0,
  );
  if (count > WORKOUT_LIMITS.steps || seconds > WORKOUT_LIMITS.seconds)
    throw new Error("Keep the workout within 500 expanded steps and 24 hours.");
  return { id: value.id.trim(), name: value.name.trim(), blocks };
}

function readBlock(value: unknown): WorkoutBlock {
  if (
    !object(value) ||
    !integer(value.repeat, 1, WORKOUT_LIMITS.repeats) ||
    !Array.isArray(value.steps) ||
    !value.steps.length ||
    value.steps.length > WORKOUT_LIMITS.steps
  )
    throw new Error("Each block needs steps and a repeat count from 1 to 20.");
  return { repeat: value.repeat, steps: value.steps.map(readStep) };
}

function readStep(value: unknown): WorkoutStep {
  if (
    !object(value) ||
    !shortText(value.name) ||
    !number(value.seconds, 1, WORKOUT_LIMITS.seconds) ||
    !number(value.watts, 0, 600) ||
    !["easy", "steady", "hard"].includes(String(value.effort))
  )
    throw new Error("Each step needs a name, a positive duration, and a target from 0 to 600 W.");
  if (value.endWatts !== undefined && !number(value.endWatts, 0, 600))
    throw new Error("Ramp end power must be between 0 and 600 W.");
  if (value.cadenceRpm !== undefined && !number(value.cadenceRpm, 1, 250))
    throw new Error("Cadence targets must be between 1 and 250 rpm.");
  return {
    name: value.name.trim(),
    seconds: value.seconds,
    watts: value.watts,
    effort: value.effort as WorkoutStep["effort"],
    ...(value.endWatts === undefined ? {} : { endWatts: value.endWatts }),
    ...(value.cadenceRpm === undefined ? {} : { cadenceRpm: value.cadenceRpm }),
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function shortText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 100;
}
function number(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}
function integer(value: unknown, min: number, max: number): value is number {
  return number(value, min, max) && Number.isInteger(value);
}
