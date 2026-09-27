import type { RideStatus } from "./ride";
import type { RideControlMode } from "./ride-control";
import type { ValueRange } from "./services";
import { currentStep, formatTime, type Workout } from "./workout";
import { workoutTarget } from "./workout-intensity";

export interface UpNextModel {
  label: string;
  name: string;
  detail: string;
  countdown: string;
  soon: boolean;
  remaining: number;
  currentIndex: number;
  nextIndex: number | null;
}

export function upNext(
  workout: Workout,
  elapsed: number,
  status: RideStatus,
  controlMode: RideControlMode,
  intensity = 100,
  adjustment = 0,
  powerRange?: ValueRange,
): UpNextModel | null {
  if (
    workout.seconds === null ||
    workout.steps.length === 0 ||
    ["finished", "interrupted", "stopping"].includes(status)
  )
    return null;

  const current = currentStep(workout, Math.max(0, elapsed));
  const next = workout.steps[current.index + 1];
  const details: string[] = [];
  if (next) {
    if (controlMode === "erg") {
      const start = workoutTarget(next.watts, intensity, adjustment, powerRange);
      const end = workoutTarget(next.endWatts ?? next.watts, intensity, adjustment, powerRange);
      const reference = workout.referenceWatts;
      if (reference !== undefined && Number.isFinite(reference) && reference > 0) {
        details.push(`${targetRange((start / reference) * 100, (end / reference) * 100)}%`);
      }
      details.push(`${targetRange(start, end)} W`);
    }
    details.push(formatTime(next.seconds));
    if (next.cadenceRpm !== undefined) details.push(`${next.cadenceRpm} rpm`);
  } else {
    details.push(
      /^cool[ -]?down$/i.test(current.step.name) ? "Cool down complete" : "Workout complete",
    );
  }

  const time = formatTime(current.remaining);
  const readyStep = /^warm[ -]?up$/i.test(current.step.name) ? "warm-up" : current.step.name;
  const countdown =
    status === "paused"
      ? `Paused · ${time} left`
      : status === "ready"
        ? `After ${readyStep} · ${time}`
        : status === "starting"
          ? `Starting · ${time} left`
          : `In ${time}`;
  return {
    label: "Up next",
    name: next?.name ?? "Finish line",
    detail: details.join(" · "),
    countdown,
    soon: status === "riding" && current.remaining > 0 && current.remaining <= 10,
    remaining: current.remaining,
    currentIndex: current.index,
    nextIndex: next ? current.index + 1 : null,
  };
}

function targetRange(start: number, end: number): string {
  const from = Math.round(start);
  const to = Math.round(end);
  return from === to ? String(from) : `${from} → ${to}`;
}
