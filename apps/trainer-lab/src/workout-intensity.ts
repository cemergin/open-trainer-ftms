import type { ValueRange } from "./services";
import { trainerWatts } from "./workout";

export const MIN_INTENSITY = 50;
export const MAX_INTENSITY = 150;

export function validWorkoutIntensity(value: unknown, controlMode?: string): boolean {
  return (
    value === undefined ||
    (typeof value === "number" &&
      Number.isInteger(value) &&
      value >= MIN_INTENSITY &&
      value <= MAX_INTENSITY &&
      ((controlMode ?? "erg") === "erg" || value === 100))
  );
}

export function workoutTarget(
  watts: number,
  intensity = 100,
  adjustment = 0,
  range?: ValueRange,
): number {
  return trainerWatts(((watts + adjustment) * intensity) / 100, range);
}
