import { describe, expect, it } from "vitest";
import { validWorkoutIntensity, workoutTarget } from "../src/workout-intensity";

describe("recovered workout intensity", () => {
  it("accepts the complete five-point grid and legacy defaults", () => {
    for (let intensity = 50; intensity <= 150; intensity += 5)
      expect(validWorkoutIntensity(intensity, "erg")).toBe(true);
    expect(validWorkoutIntensity(undefined)).toBe(true);
    expect(validWorkoutIntensity(100, "terrain")).toBe(true);
    expect(validWorkoutIntensity(100, "resistance")).toBe(true);
  });

  it("rejects off-grid, out-of-range, and nonnumeric values", () => {
    for (const intensity of [49, 51, 56, 99.5, 101, 149, 151, NaN, Infinity, "100", null])
      expect(validWorkoutIntensity(intensity)).toBe(false);
    expect(validWorkoutIntensity(105, "terrain")).toBe(false);
    expect(validWorkoutIntensity(95, "resistance")).toBe(false);
  });
});

describe("workout intensity targets", () => {
  it("defaults to the original target and scales the legacy watt adjustment", () => {
    expect(workoutTarget(120)).toBe(120);
    expect(workoutTarget(120, 110, 10)).toBe(143);
    expect(workoutTarget(80, 50, -10)).toBe(35);
  });

  it("rounds and clamps the scaled result on the trainer's power grid", () => {
    const range = { minimum: 25, maximum: 248, increment: 10 };
    expect(workoutTarget(100, 110, 0, range)).toBe(115);
    expect(workoutTarget(250, 150, 0, range)).toBe(245);
    expect(workoutTarget(30, 50, 0, range)).toBe(25);
    expect(workoutTarget(500, 150)).toBe(600);
  });
});
