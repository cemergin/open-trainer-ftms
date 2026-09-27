import { describe, expect, it } from "vitest";
import { upNext } from "../src/up-next";
import { createWorkout, type Workout } from "../src/workout";

const workout: Workout = {
  name: "Progressive ride",
  seconds: 230,
  referenceWatts: 100,
  steps: [
    { name: "Warm up", seconds: 100, watts: 60, effort: "easy" },
    {
      name: "Build",
      seconds: 70,
      watts: 80,
      endWatts: 110,
      cadenceRpm: 85,
      effort: "hard",
    },
    { name: "Cool down", seconds: 60, watts: 50, effort: "easy" },
  ],
};

describe("up next workout preview", () => {
  it("shows the next block's relative effort, power range, duration, and cadence", () => {
    expect(upNext(workout, 20, "riding", "erg")).toMatchObject({
      label: "Up next",
      name: "Build",
      detail: "80 → 110% · 80 → 110 W · 01:10 · 85 rpm",
      countdown: "In 01:20",
      remaining: 80,
      currentIndex: 0,
      nextIndex: 1,
      soon: false,
    });
  });

  it("highlights exactly the final ten seconds while riding", () => {
    expect(upNext(workout, 89, "riding", "erg")?.soon).toBe(false);
    expect(upNext(workout, 90, "riding", "erg")?.soon).toBe(true);
    expect(upNext(workout, 99.9, "riding", "erg")?.countdown).toBe("In 00:01");
    expect(upNext(workout, 100, "riding", "erg")).toMatchObject({
      name: "Cool down",
      countdown: "In 01:10",
      currentIndex: 1,
      nextIndex: 2,
      soon: false,
    });
  });

  it("keeps paused and recovered countdowns visible without the transition highlight", () => {
    expect(upNext(workout, 90, "paused", "erg")).toMatchObject({
      name: "Build",
      countdown: "Paused · 00:10 left",
      soon: false,
    });
    expect(upNext(workout, 130, "paused", "erg")).toMatchObject({
      name: "Cool down",
      countdown: "Paused · 00:40 left",
      currentIndex: 1,
      nextIndex: 2,
    });
  });

  it("previews the ready workout without implying the countdown has started", () => {
    expect(upNext(workout, 0, "ready", "erg")).toMatchObject({
      name: "Build",
      countdown: "After warm-up · 01:40",
      soon: false,
    });
    expect(upNext(workout, 90, "starting", "erg")).toMatchObject({
      countdown: "Starting · 00:10 left",
      soon: false,
    });
  });

  it("shows a finish line instead of inventing another target after the final block", () => {
    expect(upNext(workout, 170, "riding", "erg")).toMatchObject({
      name: "Finish line",
      detail: "Cool down complete",
      countdown: "In 01:00",
      currentIndex: 2,
      nextIndex: null,
      soon: false,
    });
    expect(upNext(workout, 230, "riding", "erg")).toMatchObject({
      name: "Finish line",
      countdown: "In 00:00",
      soon: false,
    });
    const singleBlock: Workout = { ...workout, steps: workout.steps.slice(0, 1), seconds: 100 };
    expect(upNext(singleBlock, 10, "riding", "erg")?.detail).toBe("Workout complete");
  });

  it.each(["ready", "riding", "paused", "finished"] as const)(
    "hides free rides when %s",
    (status) => {
      expect(upNext(createWorkout("free", 10, 100), 20, status, "erg")).toBeNull();
    },
  );

  it.each(["finished", "interrupted", "stopping"] as const)("hides %s rides", (status) => {
    expect(upNext(workout, 90, status, "erg")).toBeNull();
  });

  it("scales the adjusted ramp endpoints and respects the trainer range", () => {
    const preset = { ...workout, referenceWatts: 90 };
    const range = { minimum: 30, maximum: 105, increment: 5 };
    expect(upNext(preset, 0, "ready", "erg", 90, 8)?.detail).toBe(
      "88 → 118% · 79 → 106 W · 01:10 · 85 rpm",
    );
    expect(upNext(preset, 0, "ready", "erg", 90, 8, range)?.detail).toBe(
      "89 → 117% · 80 → 105 W · 01:10 · 85 rpm",
    );
    expect(workout.steps[1]?.watts).toBe(80);
    expect(workout.steps[1]?.endWatts).toBe(110);
  });

  it("preserves descending ramps and omits percentages for custom workouts", () => {
    const custom: Workout = {
      ...workout,
      referenceWatts: undefined,
      steps: workout.steps.map((step, index) =>
        index === 1 ? { ...step, watts: 110, endWatts: 80 } : step,
      ),
    };
    expect(upNext(custom, 0, "ready", "erg", 80)?.detail).toBe("88 → 64 W · 01:10 · 85 rpm");
  });

  it.each(["resistance", "terrain"] as const)(
    "shows timing and cadence without a fictional power target in %s mode",
    (mode) => {
      expect(upNext(workout, 0, "riding", mode, 125, 20)?.detail).toBe("01:10 · 85 rpm");
    },
  );

  it("uses the workout position after skipping rather than the actual ride duration", () => {
    expect(upNext(workout, 100, "paused", "erg")).toMatchObject({
      name: "Cool down",
      remaining: 70,
    });
    expect(upNext(workout, 170, "paused", "erg")).toMatchObject({
      name: "Finish line",
      remaining: 60,
    });
  });
});
