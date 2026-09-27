import { describe, expect, it } from "vitest";
import { createWorkout, type WorkoutMode } from "../src/workout";
import { profileFromWorkout, workoutFromProfile } from "../src/workout-profile";
import { spiceWorkout } from "../src/workout-spice";

const modes: Exclude<WorkoutMode, "free">[] = [
  "recovery",
  "endurance",
  "intervals",
  "hills",
  "mountain",
  "tempo",
];
const durations = [10, 15, 20, 30, 40, 45, 60, 120];
const variations = [1, 2, 3, 17, 42, 100, 999, 5000, 9999];

describe("preset workout variations", () => {
  it.each(modes)("preserves %s duration and bookends across supported settings", (mode) => {
    for (const minutes of durations) {
      for (const watts of [25, 75, 100, 300, 600]) {
        const base = createWorkout(mode, minutes, watts);
        const before = structuredClone(base);
        const peak = Math.min(600, Math.max(...base.steps.map((step) => step.watts)));
        for (const variation of variations) {
          const workout = spiceWorkout(base, mode, variation);
          expect(workout.seconds).toBe(base.seconds);
          expect(workout.steps.reduce((sum, step) => sum + step.seconds, 0)).toBeCloseTo(
            minutes * 60,
            6,
          );
          expect(workout.steps[0]).toEqual(base.steps[0]);
          expect(workout.steps.at(-1)).toEqual(base.steps.at(-1));
          expect(workout.name).toBe(`${base.name} · Spice ${variation}`);
          expect(workout.spice).toEqual({ mode, variation });
          const main = workout.steps.slice(1, -1);
          expect(main.length).toBeLessThanOrEqual(12);
          for (const step of main) {
            expect(Number.isInteger(step.seconds)).toBe(true);
            expect(step.seconds).toBeGreaterThanOrEqual(20 - 1e-6);
            for (const target of [step.watts, step.endWatts ?? step.watts]) {
              expect(target).toBeGreaterThanOrEqual(0);
              expect(target).toBeLessThanOrEqual(peak);
            }
          }
          const roundtrip = workoutFromProfile(profileFromWorkout(workout));
          expect(roundtrip.steps).toEqual(workout.steps);
          expect(roundtrip.seconds).toBeCloseTo(workout.seconds ?? 0, 6);
        }
        expect(base).toEqual(before);
      }
    }
  });

  it.each(modes)("reproduces %s variations while changing the actual profile", (mode) => {
    const base = createWorkout(mode, 20, 100);
    const profiles = new Set<string>();
    for (let variation = 1; variation <= 100; variation++) {
      const workout = spiceWorkout(base, mode, variation);
      expect(spiceWorkout(base, mode, variation)).toEqual(workout);
      profiles.add(JSON.stringify(workout.steps));
    }
    expect(profiles.size).toBe(100);
  });

  it("keeps recovery gentle and endurance close to its original target", () => {
    for (const mode of ["recovery", "endurance"] as const) {
      const base = createWorkout(mode, 15, 100);
      const target = base.steps[1]?.watts ?? 0;
      for (const variation of variations) {
        const main = spiceWorkout(base, mode, variation).steps.slice(1, -1);
        for (const step of main) {
          expect(step.effort).toBe(mode === "recovery" ? "easy" : "steady");
          for (const watts of [step.watts, step.endWatts ?? step.watts]) {
            expect(watts).toBeGreaterThanOrEqual(target * 0.85);
            expect(watts).toBeLessThanOrEqual(mode === "recovery" ? target - 1 : target);
          }
          if (mode === "recovery")
            expect(Math.abs(step.watts - (step.endWatts ?? step.watts))).toBeLessThanOrEqual(
              target * 0.1,
            );
        }
      }
    }
  });

  it("retains five alternating efforts and recoveries", () => {
    for (const variation of variations) {
      const main = spiceWorkout(
        createWorkout("intervals", 10, 100),
        "intervals",
        variation,
      ).steps.slice(1, -1);
      expect(main.map((step) => step.effort)).toEqual(
        Array.from({ length: 5 }, () => ["hard", "easy"]).flat(),
      );
      expect(main.filter((step) => step.effort === "hard").every((step) => step.watts >= 100)).toBe(
        true,
      );
      expect(
        main
          .filter((step) => step.effort === "easy")
          .every((step) => (step.endWatts ?? step.watts) <= 65),
      ).toBe(true);
    }
  });

  it("makes three rolling hills and a single mountain summit", () => {
    for (const variation of variations) {
      const hills = spiceWorkout(createWorkout("hills", 30, 100), "hills", variation).steps.slice(
        1,
        -1,
      );
      expect(hills.filter((step) => step.name.startsWith("Peak"))).toHaveLength(3);
      expect(hills.filter((step) => step.name.startsWith("Valley"))).toHaveLength(3);
      const mountain = spiceWorkout(
        createWorkout("mountain", 30, 100),
        "mountain",
        variation,
      ).steps.slice(1, -1);
      for (const [index, step] of mountain.entries()) {
        expect(step.endWatts).toBeDefined();
        expect(Math.sign((step.endWatts ?? 0) - step.watts)).toBe(index < 4 ? 1 : -1);
        if (index > 0) expect(step.watts).toBe(mountain[index - 1]?.endWatts);
      }
    }
  });

  it("leaves free rides untouched and rejects invalid indices", () => {
    const free = createWorkout("free", 20, 100);
    expect(spiceWorkout(free, "free", 1)).toBe(free);
    const base = createWorkout("endurance", 20, 100);
    for (const variation of [0, -1, 1.5, 10000, NaN, Infinity])
      expect(() => spiceWorkout(base, "endurance", variation)).toThrow(/1 to 9999/);
  });
});
