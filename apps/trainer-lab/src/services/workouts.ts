import { validateWorkoutProfile, type WorkoutProfile } from "../workout-profile";

const KEY = "open-trainer:workouts:v1";
export const WORKOUT_PROFILE_LIMIT = 30;
export const WORKOUT_JSON_LIMIT = 256_000;
const STORE_LIMIT = WORKOUT_JSON_LIMIT * WORKOUT_PROFILE_LIMIT;

export function parseWorkoutJson(json: string): WorkoutProfile {
  if (json.length > WORKOUT_JSON_LIMIT)
    throw new Error("Workout files must be smaller than 256 KB.");
  const value: unknown = JSON.parse(json);
  if (!object(value) || value.version !== 1)
    throw new Error("Choose an Open Trainer workout JSON file (version 1).");
  return validateWorkoutProfile(value);
}

export function exportWorkoutJson(profile: WorkoutProfile): string {
  return JSON.stringify({ version: 1, ...validateWorkoutProfile(profile) }, null, 2);
}

export function loadWorkoutProfiles(): WorkoutProfile[] {
  const json = localStorage.getItem(KEY);
  if (json === null) return [];
  if (json.length > STORE_LIMIT) throw new Error("Saved workout data is too large to load.");
  const value: unknown = JSON.parse(json);
  if (
    !object(value) ||
    value.version !== 1 ||
    !Array.isArray(value.profiles) ||
    value.profiles.length > WORKOUT_PROFILE_LIMIT
  )
    throw new Error(
      "Saved workout data could not be read. Export your workouts before clearing browser data.",
    );
  return value.profiles.map(validateWorkoutProfile);
}

export function saveWorkoutProfile(profile: WorkoutProfile): void {
  const valid = validateWorkoutProfile(profile);
  const profiles = loadWorkoutProfiles().filter((saved) => saved.id !== valid.id);
  if (profiles.length >= WORKOUT_PROFILE_LIMIT)
    throw new Error("You have 30 saved workouts. Remove one before saving another.");
  writeProfiles([valid, ...profiles]);
}

export function removeWorkoutProfile(id: string): void {
  writeProfiles(loadWorkoutProfiles().filter((profile) => profile.id !== id));
}

function writeProfiles(profiles: WorkoutProfile[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, profiles }));
  } catch {
    throw new Error(
      "Your browser could not save this workout. Download its JSON file to keep a copy.",
    );
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
