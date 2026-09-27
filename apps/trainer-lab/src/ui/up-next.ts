import type { RideStatus } from "../ride";
import type { RideControlMode } from "../ride-control";
import type { ValueRange } from "../services";
import { upNext } from "../up-next";
import type { Workout } from "../workout";
import { byId } from "./dom";

export function renderUpNext(
  workout: Workout,
  elapsed: number,
  status: RideStatus,
  controlMode: RideControlMode,
  intensity = 100,
  adjustment = 0,
  powerRange?: ValueRange,
): void {
  const model = upNext(workout, elapsed, status, controlMode, intensity, adjustment, powerRange);
  const card = byId("up-next");
  card.hidden = model === null;
  card.dataset.soon = String(model?.soon ?? false);
  if (!model) return;
  byId("up-next-label").textContent = model.label;
  byId("up-next-name").textContent = model.name;
  byId("up-next-detail").textContent = model.detail;
  byId("up-next-countdown").textContent = model.countdown;
}
