import type { Workout, WorkoutMode, WorkoutStep } from "./workout";

/** Produce a repeatable variation of a timed preset without changing its bookends. */
export function spiceWorkout(workout: Workout, mode: WorkoutMode, variation: number): Workout {
  if (mode === "free" || workout.seconds === null) return workout;
  if (!Number.isInteger(variation) || variation < 1 || variation > 9999)
    throw new Error("Choose a variation from 1 to 9999.");
  const warmup = workout.steps[0];
  const cooldown = workout.steps.at(-1);
  const original = workout.steps.slice(1, -1);
  if (!warmup || !cooldown || !original.length)
    throw new Error("Choose a preset with a warmup, main section, and cooldown.");

  const peak = Math.min(
    600,
    Math.max(...original.flatMap((step) => [step.watts, step.endWatts ?? step.watts])),
  );
  const ceiling = mode === "recovery" ? Math.max(0, peak - 1) : peak;
  let state = variation;
  const random = (low: number, high: number): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return low + (high - low) * (state / 4294967296);
  };
  const power = (factor: number): number =>
    Math.min(ceiling, Math.max(0, Math.round(peak * factor)));
  const plans: { step: WorkoutStep; weight: number }[] = [];
  const add = (
    name: string,
    from: number,
    to: number,
    effort: WorkoutStep["effort"],
    weight = 1,
  ): void => {
    plans.push({
      step: { name, seconds: 0, watts: power(from), endWatts: power(to), effort },
      weight: weight * random(0.7, 1.3),
    });
  };

  switch (mode) {
    case "endurance":
    case "recovery": {
      const low = mode === "recovery" ? 0.9 : 0.86;
      const high = mode === "recovery" ? 0.98 : 1;
      let previous = random(low, high);
      for (let i = 0; i < 8; i++) {
        const next = random(low, high);
        add(
          `${mode === "recovery" ? "Easy spin" : "Find your rhythm"} ${i + 1}`,
          previous,
          next,
          mode === "recovery" ? "easy" : "steady",
        );
        previous = next;
      }
      break;
    }
    case "intervals":
      for (let i = 0; i < 5; i++) {
        add(`Effort ${i + 1} of 5`, random(0.86, 0.93), random(0.94, 1), "hard");
        add(`Recovery ${i + 1} of 5`, random(0.44, 0.5), random(0.44, 0.5), "easy");
      }
      break;
    case "hills":
      for (let i = 0; i < 3; i++) {
        const valley = random(0.46, 0.54);
        const shoulder = random(0.66, 0.76);
        const crest = random(0.88, 1);
        add(`Rise ${i + 1}`, valley, shoulder, "steady");
        add(`Peak ${i + 1}`, shoulder, crest, "hard");
        add(`Roll down ${i + 1}`, crest, valley, "hard");
        add(`Valley ${i + 1}`, valley, valley, "easy");
      }
      break;
    case "mountain": {
      const boundaries = [0.64, 0.72, 0.81, 0.9, 0.98, 0.9, 0.78, 0.65, 0.55].map(
        (factor) => factor + random(-0.02, 0.02),
      );
      const names = [
        "Foothills",
        "Climbing",
        "High slopes",
        "The summit",
        "Over the top",
        "Descending",
        "Lower slopes",
        "Back to earth",
      ];
      for (const [i, name] of names.entries()) {
        const from = boundaries[i];
        const to = boundaries[i + 1];
        if (from === undefined || to === undefined) continue;
        add(
          name,
          from,
          to,
          i >= 2 && i <= 4 ? "hard" : i === 7 ? "easy" : "steady",
          i < 4 ? 1.2 : 0.8,
        );
      }
      break;
    }
    case "tempo": {
      const levels = [0.82, 0.86, 0.9, 0.96, 0.99, 0.96, 0.92, 0.88, 0.86];
      for (const [i, level] of levels.entries()) {
        const factor = level * random(0.97, 1.01);
        add(
          i < 3
            ? `Build momentum ${i + 1}`
            : i < 6
              ? `Tempo cruise ${i - 2}`
              : `Settle in ${i - 5}`,
          factor,
          factor * random(0.98, 1.02),
          i >= 3 && i < 6 ? "hard" : "steady",
        );
      }
      break;
    }
  }

  const middleSeconds = workout.seconds - warmup.seconds - cooldown.seconds;
  const extraSeconds = middleSeconds - plans.length * 20;
  if (extraSeconds < 0) throw new Error("Choose a preset lasting at least ten minutes.");
  const weightSum = plans.reduce((sum, plan) => sum + plan.weight, 0);
  let usedSeconds = 0;
  const middle = plans.map(({ step, weight }, index) => {
    const seconds =
      index === plans.length - 1
        ? middleSeconds - usedSeconds
        : 20 + Math.floor((extraSeconds * weight) / weightSum);
    usedSeconds += seconds;
    return { ...step, seconds };
  });
  return {
    ...workout,
    name: `${workout.name} · Spice ${variation}`,
    steps: [{ ...warmup }, ...middle, { ...cooldown }],
    spice: { mode, variation },
  };
}
