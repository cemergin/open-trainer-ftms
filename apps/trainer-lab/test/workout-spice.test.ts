import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkout, type SpiceLevel, type WorkoutMode } from "../src/workout";
import { profileFromWorkout, workoutFromProfile } from "../src/workout-profile";
import { SPICE_LEVEL_LABELS, spiceWorkout } from "../src/workout-spice";
import { mountWorkoutSpice } from "../src/ui/workout-spice";

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
const levels: SpiceLevel[] = ["mild", "spicy", "hot"];

describe("preset workout variations", () => {
  it.each(modes.flatMap((mode) => levels.map((level) => [mode, level] as const)))(
    "preserves %s %s duration and bookends across supported settings",
    (mode, level) => {
      for (const minutes of durations) {
        for (const watts of [25, 75, 100, 300, 600]) {
          const base = createWorkout(mode, minutes, watts);
          const before = structuredClone(base);
          const peak = Math.min(600, Math.max(...base.steps.map((step) => step.watts)));
          for (const variation of variations) {
            const workout = spiceWorkout(base, mode, variation, level);
            expect(workout.seconds).toBe(base.seconds);
            expect(workout.steps.reduce((sum, step) => sum + step.seconds, 0)).toBeCloseTo(
              minutes * 60,
              6,
            );
            expect(workout.steps[0]).toEqual(base.steps[0]);
            expect(workout.steps.at(-1)).toEqual(base.steps.at(-1));
            expect(workout.name).toBe(
              `${base.name} · ${SPICE_LEVEL_LABELS[level]} mix ${variation}`,
            );
            expect(workout.spice).toEqual({ mode, variation, level });
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
    },
  );

  it.each(modes.flatMap((mode) => levels.map((level) => [mode, level] as const)))(
    "reproduces %s %s variations while changing the actual profile",
    (mode, level) => {
      const base = createWorkout(mode, 20, 100);
      const profiles = new Set<string>();
      for (let variation = 1; variation <= 100; variation++) {
        const workout = spiceWorkout(base, mode, variation, level);
        expect(spiceWorkout(base, mode, variation, level)).toEqual(workout);
        profiles.add(JSON.stringify(workout.steps));
      }
      expect(profiles.size).toBe(100);
    },
  );

  it.each(levels)(
    "keeps %s recovery gentle and endurance close to its original target",
    (level) => {
      for (const mode of ["recovery", "endurance"] as const) {
        const base = createWorkout(mode, 15, 100);
        const target = base.steps[1]?.watts ?? 0;
        for (const variation of variations) {
          const main = spiceWorkout(base, mode, variation, level).steps.slice(1, -1);
          for (const step of main) {
            expect(step.effort).toBe(mode === "recovery" ? "easy" : "steady");
            for (const watts of [step.watts, step.endWatts ?? step.watts]) {
              expect(watts).toBeGreaterThanOrEqual(target * (mode === "recovery" ? 0.88 : 0.83));
              expect(watts).toBeLessThanOrEqual(mode === "recovery" ? target - 1 : target);
            }
            if (mode === "recovery")
              expect(Math.abs(step.watts - (step.endWatts ?? step.watts))).toBeLessThanOrEqual(
                target * 0.1,
              );
          }
        }
      }
    },
  );

  it.each(levels)("retains five alternating %s efforts and recoveries", (level) => {
    for (const variation of variations) {
      const main = spiceWorkout(
        createWorkout("intervals", 10, 100),
        "intervals",
        variation,
        level,
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
          .every((step) => (step.endWatts ?? step.watts) <= 75),
      ).toBe(true);
    }
  });

  it.each(levels)("makes three rolling %s hills and a single mountain summit", (level) => {
    for (const variation of variations) {
      const hills = spiceWorkout(
        createWorkout("hills", 30, 100),
        "hills",
        variation,
        level,
      ).steps.slice(1, -1);
      expect(hills.filter((step) => step.name.startsWith("Peak"))).toHaveLength(3);
      expect(hills.filter((step) => step.name.startsWith("Valley"))).toHaveLength(3);
      const mountain = spiceWorkout(
        createWorkout("mountain", 30, 100),
        "mountain",
        variation,
        level,
      ).steps.slice(1, -1);
      for (const [index, step] of mountain.entries()) {
        expect(step.endWatts).toBeDefined();
        expect(Math.sign((step.endWatts ?? 0) - step.watts)).toBe(index < 4 ? 1 : -1);
        if (index > 0) expect(step.watts).toBe(mountain[index - 1]?.endWatts);
      }
    }
  });

  it.each(modes)(
    "makes %s seasoning alter the power and timing, within the same peak limit",
    (mode) => {
      const base = createWorkout(mode, 30, 300);
      const spread = (level: SpiceLevel): { power: number; duration: number } => {
        let power = 0;
        let duration = 0;
        for (const variation of variations) {
          const main = spiceWorkout(base, mode, variation, level).steps.slice(1, -1);
          const watts = main.flatMap((step) => [step.watts, step.endWatts ?? step.watts]);
          const seconds = main.map((step) => step.seconds);
          power += Math.max(...watts) - Math.min(...watts);
          duration += Math.max(...seconds) - Math.min(...seconds);
        }
        return { power, duration };
      };
      const mild = spread("mild");
      const spicy = spread("spicy");
      const hot = spread("hot");
      expect(mild.power).toBeLessThan(spicy.power);
      expect(spicy.power).toBeLessThan(hot.power);
      expect(mild.duration).toBeLessThan(spicy.duration);
      expect(spicy.duration).toBeLessThan(hot.duration);
    },
  );

  it("preserves the original Spicy seed output when the level is omitted", () => {
    const originals = {
      recovery: [
        [100, 64, 63],
        [91, 63, 64],
        [94, 64, 63],
        [114, 63, 64],
        [113, 64, 69],
        [103, 69, 66],
        [101, 66, 68],
        [84, 68, 64],
      ],
      endurance: [
        [100, 90, 87],
        [91, 87, 89],
        [94, 89, 86],
        [114, 86, 88],
        [113, 88, 100],
        [103, 100, 93],
        [101, 93, 98],
        [84, 98, 87],
      ],
      intervals: [
        [84, 110, 118],
        [64, 57, 58],
        [95, 111, 118],
        [81, 62, 61],
        [85, 113, 124],
        [98, 56, 56],
        [83, 116, 124],
        [72, 56, 59],
        [68, 116, 124],
        [70, 61, 59],
      ],
      hills: [
        [56, 60, 84],
        [60, 84, 119],
        [51, 119, 60],
        [62, 60, 60],
        [73, 59, 93],
        [63, 93, 125],
        [67, 125, 59],
        [73, 59, 59],
        [75, 63, 84],
        [75, 84, 112],
        [74, 112, 63],
        [71, 63, 63],
      ],
      mountain: [
        [136, 76, 84],
        [128, 84, 98],
        [109, 98, 107],
        [117, 107, 117],
        [92, 117, 106],
        [83, 106, 93],
        [65, 93, 76],
        [70, 76, 68],
      ],
      tempo: [
        [92, 88, 87],
        [69, 93, 92],
        [104, 98, 96],
        [88, 107, 108],
        [92, 108, 110],
        [107, 103, 101],
        [91, 102, 103],
        [78, 95, 95],
        [79, 95, 97],
      ],
    };
    for (const mode of modes) {
      const base = createWorkout(mode, 20, 100);
      const workout = spiceWorkout(base, mode, 42);
      expect(workout).toEqual(spiceWorkout(base, mode, 42, "spicy"));
      expect(
        workout.steps
          .slice(1, -1)
          .map(({ seconds, watts, endWatts }) => [seconds, watts, endWatts]),
      ).toEqual(originals[mode]);
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

class SpiceElement extends EventTarget {
  value = "";
  checked = false;
  disabled = false;
  textContent = "";
  dataset: Record<string, string> = {};
}

function mountSpiceControls(): {
  controls: ReturnType<typeof mountWorkoutSpice>;
  refresh: ReturnType<typeof vi.fn>;
  element: (id: string) => SpiceElement;
  setMode: (next: WorkoutMode) => void;
} {
  const elements = new Map(
    [
      "spice-toggle",
      "spice-level",
      "spice-shuffle",
      "spice-setting",
      "spice-index",
      "spice-help",
    ].map((id) => [id, new SpiceElement()]),
  );
  for (const name of ["HTMLElement", "HTMLInputElement", "HTMLSelectElement", "HTMLButtonElement"])
    vi.stubGlobal(name, SpiceElement);
  vi.stubGlobal("document", { getElementById: (id: string) => elements.get(id) });
  let mode: WorkoutMode = "hills";
  const refresh = vi.fn();
  const controls = mountWorkoutSpice(() => mode, refresh);
  return {
    controls,
    refresh,
    element: (id: string) => {
      const element = elements.get(`spice-${id}`);
      if (!element) throw new Error(`Unknown Spice control: ${id}`);
      return element;
    },
    setMode: (next: WorkoutMode) => {
      mode = next;
    },
  };
}

describe("Spice level controls", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("previews changes and remembers each preset's level, mix, and Off choice", () => {
    const { controls, element, setMode, refresh } = mountSpiceControls();
    const hills = createWorkout("hills", 20, 100);
    element("level").value = "hot";
    element("level").dispatchEvent(new Event("change"));
    expect(refresh).toHaveBeenCalledOnce();
    expect(controls.apply(hills, "hills", "erg")).toBe(hills);
    element("toggle").checked = true;
    element("toggle").dispatchEvent(new Event("change"));
    element("shuffle").dispatchEvent(new Event("click"));
    expect(controls.apply(hills, "hills", "erg").spice).toEqual({
      mode: "hills",
      variation: 2,
      level: "hot",
    });

    setMode("intervals");
    const intervals = createWorkout("intervals", 20, 100);
    controls.update(intervals, "intervals", "erg", false, false);
    expect(element("level").value).toBe("spicy");
    expect(element("toggle").checked).toBe(false);
    element("level").value = "mild";
    element("level").dispatchEvent(new Event("change"));
    element("toggle").checked = true;
    element("toggle").dispatchEvent(new Event("change"));
    expect(controls.apply(intervals, "intervals", "erg").spice).toEqual({
      mode: "intervals",
      variation: 1,
      level: "mild",
    });

    setMode("hills");
    const hot = controls.apply(hills, "hills", "erg");
    controls.update(hot, "hills", "erg", false, false);
    expect(element("level").value).toBe("hot");
    expect(element("setting").dataset.level).toBe("hot");
    expect(element("index").textContent).toBe("Hot mix 2");
    element("toggle").checked = false;
    element("toggle").dispatchEvent(new Event("change"));
    expect(controls.apply(hills, "hills", "erg")).toBe(hills);
    element("toggle").checked = true;
    element("toggle").dispatchEvent(new Event("change"));
    expect(controls.apply(hills, "hills", "erg")).toEqual(hot);
  });

  it.each([...levels, undefined])("restores a saved %s level and legacy Spicy mixes", (level) => {
    const { controls, element } = mountSpiceControls();
    const base = createWorkout("hills", 30, 100);
    const saved = spiceWorkout(base, "hills", 42, level);
    if (level === undefined) saved.spice = { mode: "hills", variation: 42 };
    controls.restore(saved);
    const restored = controls.apply(base, "hills", "erg");
    expect(restored.steps).toEqual(saved.steps);
    expect(restored.spice).toEqual({ mode: "hills", variation: 42, level: level ?? "spicy" });
    controls.update(saved, "hills", "erg", false, false);
    expect(element("level").value).toBe(level ?? "spicy");
  });

  it("locks the selector with the toggle and only shuffles active mixes", () => {
    const { controls, element } = mountSpiceControls();
    const base = createWorkout("hills", 20, 100);
    controls.update(base, "hills", "erg", false, false);
    expect(element("toggle").disabled).toBe(false);
    expect(element("level").disabled).toBe(false);
    expect(element("shuffle").disabled).toBe(true);
    const hot = spiceWorkout(base, "hills", 1, "hot");
    controls.restore(hot);
    controls.update(hot, "hills", "erg", false, false);
    expect(element("shuffle").disabled).toBe(false);
    for (const [workout, mode, control, locked, custom] of [
      [hot, "hills", "erg", true, false],
      [base, "hills", "erg", false, true],
      [base, "hills", "terrain", false, false],
      [createWorkout("free", 20, 100), "free", "erg", false, false],
    ] as const) {
      controls.update(workout, mode, control, locked, custom);
      expect(element("toggle").disabled).toBe(true);
      expect(element("level").disabled).toBe(true);
      expect(element("shuffle").disabled).toBe(true);
    }
    expect(controls.apply(base, "hills", "terrain")).toBe(base);
  });
});
