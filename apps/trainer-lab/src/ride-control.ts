import type { TrainerCapabilities, ValueRange } from "./services";
import { findRoute, routeGrade } from "./routes";
export type RideControlMode = "erg" | "resistance" | "terrain";
export interface RideOptions {
  controlMode?: RideControlMode;
  routeId?: string;
  resistance?: number;
}
export function supportsMode(
  capabilities: TrainerCapabilities | null | undefined,
  mode: RideControlMode,
): boolean {
  if (!capabilities) return false;
  return mode === "erg"
    ? capabilities.supportsPowerTarget
    : mode === "resistance"
      ? capabilities.supportsResistanceTarget
      : capabilities.supportsSimulation;
}
export function resistanceTarget(value: number, range?: ValueRange): number {
  const origin = range?.minimum ?? 0;
  const increment = Math.max(0.1, range?.increment ?? 1);
  const first = Math.max(0, Math.ceil((Math.max(0, origin) - origin) / increment));
  const ceiling = Math.max(origin + first * increment, Math.min(100, range?.maximum ?? 100));
  const last = Math.max(first, Math.floor((ceiling - origin) / increment + 1e-8));
  const step = Math.min(last, Math.max(first, Math.round((value - origin) / increment)));
  return Number((origin + step * increment).toFixed(2));
}
export function terrainTarget(
  routeId: string | undefined,
  distanceKm: number,
  adjustment: number,
): number {
  return (
    Math.round(
      Math.max(-5, Math.min(8, routeGrade(findRoute(routeId), distanceKm) + adjustment)) * 10,
    ) / 10
  );
}
