import { describe, expect, it } from "vitest";
import { currentStep } from "../src/workout";
import {
  profileFromWorkout,
  validateWorkoutProfile,
  workoutFromProfile,
  type WorkoutProfile,
} from "../src/workout-profile";

export const intervalProfile: WorkoutProfile = {
  id: "intervals",
  name: "Progressive intervals",
  blocks: [
    {
      repeat: 3,
      steps: [
        { name: "Build", seconds: 60, watts: 100, endWatts: 200, cadenceRpm: 90, effort: "hard" },
        { name: "Recover", seconds: 30, watts: 75, effort: "easy" },
      ],
    },
  ],
};

describe("editable workout profiles", () => {
  it("expands interval groups without sharing mutable step references", () => {
    const workout = workoutFromProfile(intervalProfile);
    expect(workout.seconds).toBe(270);
    expect(workout.steps.map((step) => step.name)).toEqual([
      "Build",
      "Recover",
      "Build",
      "Recover",
      "Build",
      "Recover",
    ]);
    expect(workout.steps[0]).not.toBe(workout.steps[2]);
    expect(workout.steps[0]).not.toBe(intervalProfile.blocks[0]?.steps[0]);
    expect(workout.steps[2]?.cadenceRpm).toBe(90);
  });

  it("interpolates rising and falling ramps and leaves source targets unchanged", () => {
    const workout = workoutFromProfile(intervalProfile);
    expect(currentStep(workout, -1).step.watts).toBe(100);
    expect(currentStep(workout, 30).step.watts).toBe(150);
    expect(currentStep(workout, 60).step.watts).toBe(75);
    expect(currentStep(workout, 120).step.watts).toBe(150);
    expect(workout.steps[0]?.watts).toBe(100);
    const falling = {
      name: "Cooldown",
      seconds: 60,
      steps: [{ name: "Ease", seconds: 60, watts: 200, endWatts: 50, effort: "easy" as const }],
    };
    expect(currentStep(falling, 30).step.watts).toBe(125);
    expect(currentStep(falling, 100).step.watts).toBe(50);
    expect(profileFromWorkout(falling).blocks[0]?.steps[0]?.endWatts).toBe(50);
  });

  it.each([
    { repeat: 1, stepCount: 101 },
    { repeat: 20, stepCount: 25 },
  ])("reopens expanded workouts for editing without losing steps: %j", ({ repeat, stepCount }) => {
    const workout = workoutFromProfile({
      ...intervalProfile,
      blocks: [
        {
          repeat,
          steps: Array.from({ length: stepCount }, (_, index) => ({
            name: `Ramp ${index + 1}`,
            seconds: 30,
            watts: 100 + index,
            endWatts: 150 + index,
            cadenceRpm: 90,
            effort: "steady",
          })),
        },
      ],
    });
    const editable = profileFromWorkout(workout, "editable");
    expect(editable.id).toBe("editable");
    expect(editable.blocks).toHaveLength(1);
    expect(editable.blocks[0]?.repeat).toBe(1);
    expect(editable.blocks[0]?.steps).toHaveLength(repeat * stepCount);
    expect(workoutFromProfile(editable)).toEqual(workout);
    const first = editable.blocks[0]?.steps[0];
    if (!first) throw new Error("Expected an editable step.");
    first.watts = 50;
    expect(workout.steps[0]?.watts).toBe(100);
  });

  it("still rejects workouts above the expanded step limit when reopening", () => {
    const step = { name: "Steady", seconds: 1, watts: 100, effort: "steady" as const };
    expect(() =>
      profileFromWorkout({
        name: "Oversized",
        seconds: 501,
        steps: Array.from({ length: 501 }, () => ({ ...step })),
      }),
    ).toThrow();
  });

  it.each([
    { ...intervalProfile, name: "" },
    { ...intervalProfile, blocks: [] },
    { ...intervalProfile, blocks: [{ repeat: 21, steps: intervalProfile.blocks[0]?.steps }] },
    { ...intervalProfile, blocks: [{ repeat: 1.5, steps: intervalProfile.blocks[0]?.steps }] },
    ...[0, -1, Infinity, NaN].map((seconds) => ({
      ...intervalProfile,
      blocks: [{ repeat: 1, steps: [{ ...intervalProfile.blocks[0]?.steps[0], seconds }] }],
    })),
    ...[{ watts: 601 }, { endWatts: -1 }, { cadenceRpm: 0 }, { cadenceRpm: 251 }].map(
      (invalid) => ({
        ...intervalProfile,
        blocks: [{ repeat: 1, steps: [{ ...intervalProfile.blocks[0]?.steps[0], ...invalid }] }],
      }),
    ),
  ])("rejects invalid block inputs before they can run", (value) => {
    expect(() => validateWorkoutProfile(value)).toThrow();
  });

  it("bounds expanded duration and step count", () => {
    const steps = Array.from({ length: 26 }, () => ({
      name: "Step",
      seconds: 1,
      watts: 100,
      effort: "steady",
    }));
    expect(() =>
      validateWorkoutProfile({ ...intervalProfile, blocks: [{ repeat: 20, steps }] }),
    ).toThrow(/500/);
    expect(() =>
      validateWorkoutProfile({
        ...intervalProfile,
        blocks: [{ repeat: 2, steps: [{ ...steps[0], seconds: 86400 }] }],
      }),
    ).toThrow(/24 hours/);
  });
});
