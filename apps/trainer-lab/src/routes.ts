import type { RideRecord } from "./ride";

export interface Route {
  id: string;
  name: string;
  lengthKm: number;
  grades: readonly number[];
}
export const ROUTES: readonly [Route, ...Route[]] = [
  { id: "riverside-v1", name: "Riverside loop", lengthKm: 6, grades: [0, 0.5, 1, 0, -1, 0] },
  {
    id: "rolling-v1",
    name: "Rolling country",
    lengthKm: 10,
    grades: [0, 2, 4, 1, -2, 0, 3, 5, -3, 0],
  },
  {
    id: "summit-v1",
    name: "Summit & return",
    lengthKm: 12,
    grades: [0, 2, 4, 6, 7, 4, 0, -3, -5, -3, -1, 0],
  },
];
export function findRoute(id?: string): Route {
  return ROUTES.find((route) => route.id === id) ?? ROUTES[0];
}
/** Smooth transitions between profile points; loops continue for open-ended rides. */
export function routeGrade(route: Route, distanceKm: number): number {
  const position =
    ((Math.max(0, distanceKm) % route.lengthKm) / route.lengthKm) * route.grades.length;
  const index = Math.floor(position);
  const from = route.grades[index] ?? 0;
  const to = route.grades[(index + 1) % route.grades.length] ?? from;
  return Math.round((from + (to - from) * (position - index)) * 10) / 10;
}
export function compatibleGhosts(
  records: RideRecord[],
  routeId: string,
  simulator: boolean,
): RideRecord[] {
  return records.filter(
    (record) =>
      record.controlMode === "terrain" &&
      record.routeId === routeId &&
      record.simulator === simulator &&
      record.samples.some((sample) => sample.distanceKm !== undefined),
  );
}
export function ghostDistance(record: RideRecord, seconds: number): number | null {
  if (seconds > record.seconds) return null;
  let before = { seconds: 0, distanceKm: 0 };
  for (const sample of record.samples) {
    if (sample.distanceKm === undefined) continue;
    if (sample.seconds >= seconds) {
      const fraction =
        sample.seconds > before.seconds
          ? (seconds - before.seconds) / (sample.seconds - before.seconds)
          : 0;
      return (
        before.distanceKm +
        (sample.distanceKm - before.distanceKm) * Math.max(0, Math.min(1, fraction))
      );
    }
    before = { seconds: sample.seconds, distanceKm: sample.distanceKm };
  }
  return before.distanceKm;
}
