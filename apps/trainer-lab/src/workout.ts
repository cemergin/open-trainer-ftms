import type { ValueRange } from "./services";

export const WORKOUT_OPTIONS = [
  { id: "endurance", name: "Steady ride", description: "Warm up, find your rhythm, cool down.", icon: "sun", suggestedWatts: 100 },
  { id: "intervals", name: "Five efforts", description: "Five short efforts with easy recoveries.", icon: "zap", suggestedWatts: 100 },
  { id: "recovery", name: "Recovery spin", description: "An easy spin with a gentle power target.", icon: "leaf", suggestedWatts: 75 },
  { id: "tempo", name: "Tempo cruise", description: "Build into a longer, steady effort.", icon: "wind", suggestedWatts: 100 },
  { id: "hills", name: "Rolling hills", description: "Three rises and recoveries in an ERG power profile.", icon: "activity", suggestedWatts: 90 },
  { id: "mountain", name: "Mountain climb", description: "An ERG power profile that builds to a summit, then eases.", icon: "mountain", suggestedWatts: 90 },
  { id: "free", name: "Free ride", description: "Choose your power and ride for as long as you like.", icon: "infinity", suggestedWatts: 100 },
] as const;
export type WorkoutMode = typeof WORKOUT_OPTIONS[number]["id"];
export interface WorkoutStep {
  name: string;
  seconds: number;
  watts: number;
  effort: "easy" | "steady" | "hard";
}
export interface Workout {
  name: string;
  steps: WorkoutStep[];
  seconds: number | null;
}

type ProfileStep = readonly [name: string, factor: number, effort: WorkoutStep["effort"]];
const PROFILES: Record<Exclude<WorkoutMode, "free">, readonly ProfileStep[]> = {
  endurance: [["Find your rhythm", 1, "steady"]],
  intervals: Array.from({ length: 5 }, (_, index): ProfileStep[] => [
    [`Effort ${index + 1} of 5`, 1.25, "hard"], [`Recovery ${index + 1} of 5`, 0.6, "easy"],
  ]).flat(),
  recovery: [["Easy spinning", 0.7, "easy"]],
  tempo: [["Build momentum", 0.9, "steady"], ["Tempo cruise", 1.1, "hard"], ["Settle in", 0.95, "steady"]],
  hills: [["First rise", 1.05, "hard"], ["Easy valley", 0.65, "easy"], ["Second rise", 1.15, "hard"],
    ["Easy valley", 0.65, "easy"], ["Final rise", 1.25, "hard"], ["Roll home", 0.65, "easy"]],
  mountain: [["Foothills", 0.8, "steady"], ["Climbing", 0.95, "steady"], ["High slopes", 1.1, "hard"],
    ["The summit", 1.2, "hard"], ["Over the top", 1.05, "hard"], ["Descending", 0.85, "steady"], ["Back to earth", 0.65, "easy"]],
};

export function suggestedTarget(mode: WorkoutMode, priorAveragePower?: number): number {
  const fallback = WORKOUT_OPTIONS.find(option => option.id === mode)!.suggestedWatts;
  if (priorAveragePower === undefined || !Number.isFinite(priorAveragePower) || priorAveragePower <= 0) return fallback;
  return Math.min(fallback, Math.max(25, Math.floor(priorAveragePower / 5) * 5));
}

export function createWorkout(mode: WorkoutMode, minutes: number, watts: number): Workout {
  if (!Number.isFinite(watts) || watts < 25 || watts > 600) throw new Error("Choose a target from 25 to 600 W.");
  if (!Number.isFinite(minutes) || minutes < 10 || minutes > 120) throw new Error("Choose a duration from 10 to 120 minutes.");
  const step = (name: string, seconds: number, factor: number, effort: WorkoutStep["effort"]): WorkoutStep =>
    ({ name, seconds, watts: Math.round(watts * factor), effort });
  if (mode === "free") return { name: "Free ride", seconds: null, steps: [step("Your pace", Infinity, 1, "steady")] };
  const seconds = minutes * 60;
  const bookend = Math.min(300, seconds / 6);
  const middle = seconds - bookend * 2;
  const steps = [step("Warm up", bookend, 0.6, "easy")];
  const profile = PROFILES[mode];
  for (const [name, factor, effort] of profile) steps.push(step(name, middle / profile.length, factor, effort));
  steps.push(step("Cool down", bookend, 0.5, "easy"));
  return { name: WORKOUT_OPTIONS.find(option => option.id === mode)!.name, steps, seconds };
}

export function currentStep(workout: Workout, elapsed: number): { step: WorkoutStep; index: number; remaining: number } {
  let start = 0;
  for (const [index, step] of workout.steps.entries()) {
    if (elapsed < start + step.seconds || index === workout.steps.length - 1) {
      return { step, index, remaining: Math.max(0, start + step.seconds - elapsed) };
    }
    start += step.seconds;
  }
  throw new Error("The workout has no steps.");
}

export function trainerWatts(watts: number, range?: ValueRange): number {
  if (!Number.isFinite(watts)) throw new Error("Choose a finite power target.");
  const origin = range?.minimum ?? 0;
  const maximum = Math.min(600, range?.maximum ?? 600);
  const increment = Math.max(1, range?.increment ?? 1);
  const minimum = origin + Math.ceil(Math.max(0, -origin) / increment) * increment;
  if (minimum > maximum) throw new Error("The trainer's power range is not supported.");
  const snapped = minimum + Math.round((Math.max(minimum, watts) - minimum) / increment) * increment;
  const highest = minimum + Math.floor((maximum - minimum) / increment) * increment;
  return Math.min(highest, Math.max(minimum, snapped));
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  const rounded = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(rounded / 60).toString().padStart(2, "0")}:${(rounded % 60).toString().padStart(2, "0")}`;
}
