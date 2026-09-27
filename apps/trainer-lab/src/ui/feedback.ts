export type PowerBand = "waiting" | "below" | "pocket" | "above";
export interface PowerFeedback {
  band: PowerBand;
  label: string;
  guidance: string;
  position: number;
}

export function powerFeedback(power: number | undefined, target: number, riding: boolean): PowerFeedback {
  if (!riding || power === undefined || !Number.isFinite(power) || target <= 0) {
    return { band: "waiting", label: riding ? "Waiting for power" : "Ready for your rhythm", guidance: riding ? "Fresh trainer data will appear here." : "Ride to see how your power matches the target.", position: 50 };
  }
  const delta = power - target;
  const tolerance = Math.max(5, target * 0.05);
  const position = Math.max(0, Math.min(100, 50 + delta / target * 100));
  if (Math.abs(delta) <= tolerance) return { band: "pocket", label: "In the pocket", guidance: "Right on target. Keep that smooth rhythm.", position };
  if (delta < 0) return { band: "below", label: "Build a little", guidance: `${Math.round(-delta)} W below target · keep pedaling smoothly.`, position };
  return { band: "above", label: "Ease a little", guidance: `${Math.round(delta)} W above target · let the trainer settle.`, position };
}

export function renderFeedback(power: number | undefined, target: number, speed: number | undefined, riding: boolean): void {
  const feedback = powerFeedback(power, target, riding);
  const panel = document.getElementById("ride-feedback")!;
  panel.dataset.band = feedback.band;
  panel.style.setProperty("--power-position", `${feedback.position}%`);
  panel.style.setProperty("--road-duration", `${Math.max(0.6, 4 - (speed ?? 0) / 12)}s`);
  document.getElementById("feedback-label")!.textContent = feedback.label;
  document.getElementById("feedback-guidance")!.textContent = feedback.guidance;
  document.getElementById("live-speed")!.textContent = speed === undefined || !Number.isFinite(speed) ? "—" : speed.toFixed(1);
  document.getElementById("pocket-range")!.textContent = target > 0 ? `${Math.max(0, Math.round(target - Math.max(5, target * 0.05)))}–${Math.round(target + Math.max(5, target * 0.05))} W` : "—";
  panel.classList.toggle("moving", riding && speed !== undefined && speed > 1);
  document.body.classList.toggle("in-pocket", feedback.band === "pocket");
}
