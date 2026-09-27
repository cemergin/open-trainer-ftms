import { spiceWorkout } from "../workout-spice";
import type { Workout, WorkoutMode } from "../workout";
import type { RideControlMode } from "../ride-control";
import { byId } from "./dom";

interface SpiceControls {
  apply(workout: Workout, mode: WorkoutMode, control: RideControlMode): Workout;
  restore(workout: Workout): void;
  update(
    workout: Workout,
    mode: WorkoutMode,
    control: RideControlMode,
    locked: boolean,
    custom: boolean,
  ): void;
}

export function mountWorkoutSpice(
  currentMode: () => WorkoutMode,
  refresh: () => void,
): SpiceControls {
  const toggle = byId("spice-toggle", HTMLInputElement);
  const shuffle = byId("spice-shuffle", HTMLButtonElement);
  const enabled = new Set<WorkoutMode>();
  const variations = new Map<WorkoutMode, number>();
  toggle.addEventListener("change", () => {
    if (toggle.checked) enabled.add(currentMode());
    else enabled.delete(currentMode());
    refresh();
  });
  shuffle.addEventListener("click", () => {
    const mode = currentMode();
    variations.set(mode, ((variations.get(mode) ?? 1) % 9999) + 1);
    refresh();
  });
  return {
    apply(workout, mode, control): Workout {
      return control === "erg" && mode !== "free" && enabled.has(mode)
        ? spiceWorkout(workout, mode, variations.get(mode) ?? 1)
        : workout;
    },
    restore(workout): void {
      if (!workout.spice) return;
      enabled.add(workout.spice.mode);
      variations.set(workout.spice.mode, workout.spice.variation);
    },
    update(workout, mode, control, locked, custom): void {
      const available = !custom && mode !== "free" && control === "erg";
      toggle.checked = Boolean(workout.spice);
      toggle.disabled = locked || !available;
      shuffle.disabled = toggle.disabled || !toggle.checked;
      byId("spice-setting").dataset.active = String(toggle.checked);
      byId("spice-index").textContent = workout.spice
        ? `Mix ${workout.spice.variation}`
        : "Classic";
      byId("spice-help").textContent = custom
        ? "Use a preset to add Spice. Custom workouts stay exactly as you built them."
        : mode === "free"
          ? "Choose a timed workout to mix its hills and efforts."
          : control !== "erg"
            ? "Choose ERG to remix the workout’s power profile."
            : workout.spice
              ? `${workout.steps.length} blocks · warm-up and cool-down kept.${locked ? " This mix is fixed for your ride." : " Shuffle to explore, or Edit workout to save a favourite."}`
              : "Different hills, peaks, and recoveries. Same ride length. Turn it on to preview a mix.";
    },
  };
}
