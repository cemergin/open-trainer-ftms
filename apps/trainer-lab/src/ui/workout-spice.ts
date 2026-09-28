import { SPICE_LEVEL_LABELS, spiceWorkout } from "../workout-spice";
import type { SpiceLevel, Workout, WorkoutMode } from "../workout";
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
  const level = byId("spice-level", HTMLSelectElement);
  const shuffle = byId("spice-shuffle", HTMLButtonElement);
  const enabled = new Set<WorkoutMode>();
  const variations = new Map<WorkoutMode, number>();
  const levels = new Map<WorkoutMode, SpiceLevel>();
  toggle.addEventListener("change", () => {
    if (toggle.checked) enabled.add(currentMode());
    else enabled.delete(currentMode());
    refresh();
  });
  level.addEventListener("change", () => {
    if (level.value !== "mild" && level.value !== "spicy" && level.value !== "hot") return;
    levels.set(currentMode(), level.value);
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
        ? spiceWorkout(workout, mode, variations.get(mode) ?? 1, levels.get(mode) ?? "spicy")
        : workout;
    },
    restore(workout): void {
      if (!workout.spice) return;
      enabled.add(workout.spice.mode);
      variations.set(workout.spice.mode, workout.spice.variation);
      levels.set(workout.spice.mode, workout.spice.level ?? "spicy");
    },
    update(workout, mode, control, locked, custom): void {
      const available = !custom && mode !== "free" && control === "erg";
      const effectiveLevel = workout.spice
        ? (workout.spice.level ?? "spicy")
        : (levels.get(mode) ?? "spicy");
      toggle.checked = Boolean(workout.spice);
      toggle.disabled = locked || !available;
      level.value = effectiveLevel;
      level.disabled = toggle.disabled;
      shuffle.disabled = toggle.disabled || !toggle.checked;
      byId("spice-setting").dataset.active = String(toggle.checked);
      byId("spice-setting").dataset.level = effectiveLevel;
      byId("spice-index").textContent = workout.spice
        ? `${SPICE_LEVEL_LABELS[workout.spice.level ?? "spicy"]} mix ${workout.spice.variation}`
        : "Classic";
      byId("spice-help").textContent = custom
        ? "Use a preset to add Spice. Custom workouts stay exactly as you built them."
        : mode === "free"
          ? "Choose a timed workout to mix its hills and efforts."
          : control !== "erg"
            ? "Choose ERG to remix the workout’s power profile."
            : workout.spice
              ? `${effectiveLevel === "mild" ? "A little seasoning, with smoother changes." : effectiveLevel === "hot" ? "Extra seasoning, with deeper valleys and sharper changes." : "A balanced kick, with varied peaks and recoveries."} Same ride length and peak limit; warm-up and cool-down kept.${locked ? " This mix is fixed for your ride." : " Shuffle for a fresh mix, or Edit workout to save a favourite."}`
              : "Choose your seasoning: Mild, Spicy, or Hot. Turn Spice on to preview a mix with the same ride length.";
    },
  };
}
