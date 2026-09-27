import { describe, expect, it } from "vitest";
import { workoutTarget } from "../src/workout-intensity";

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
